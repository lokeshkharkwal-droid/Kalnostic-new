import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MasterData, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CreateMasterDataDto } from './dto/create-master-data.dto';
import { UpdateMasterDataDto } from './dto/update-master-data.dto';
import {
  CannotCreateMasterDataForMainBranchException,
  CannotDeleteMainBranchMasterDataException,
  MasterDataNameConflictException,
  MasterDataNotFoundException,
} from './exceptions/master-data.exceptions';

/** Payload of the `branch.created` event emitted by BranchService. */
interface BranchCreatedEvent {
  tenantId: string;
  branchId: string;
  branchName: string;
}

/**
 * Master-data management. Tenant-scoped + branch-level (CLAUDE.md §4.6). Every
 * query carries `tenantId` (defence in depth on top of RLS, §4.3) and filters
 * soft-deleted rows. A non-main branch may hold several master data; the main
 * branch is capped at its single auto-created default. Lab tests inside a master
 * data are owned by the lab-test module (`LabTest` + children).
 */
@Injectable()
export class MasterDataService {
  private readonly logger = new Logger(MasterDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * React to a branch being created by auto-provisioning that branch's default
   * master data (named after the branch). Idempotent — does nothing if the
   * branch already has an active master data — so a redelivered event is a safe
   * no-op. Runs outside a request, so all work goes through `withTenant` to set
   * the RLS tenant context. Errors are logged and swallowed: a failed
   * auto-provision must never fail the (already-committed) branch creation.
   * @param payload the `branch.created` event
   */
  @OnEvent('branch.created')
  async handleBranchCreated(payload: BranchCreatedEvent): Promise<void> {
    try {
      await this.createDefaultForBranch(
        payload.tenantId,
        payload.branchId,
        payload.branchName,
      );
    } catch (e) {
      this.logger.error(
        `Failed to auto-create master data for branch ${payload.branchId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /**
   * Create the default master data for a branch if it has none. Used by the
   * `branch.created` handler. Idempotent via an existence check in the same
   * transaction.
   * @param tenantId owning tenant
   * @param branchId the branch to provision
   * @param branchName seeds the master data's name
   * @returns the created master data, or null if one already existed
   */
  async createDefaultForBranch(
    tenantId: string,
    branchId: string,
    branchName: string,
  ): Promise<MasterData | null> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.masterData.count({
        where: { tenantId, branchId, deletedAt: null },
      });
      if (existing > 0) {
        return null;
      }
      return tx.masterData.create({
        data: { tenantId, branchId, name: branchName, description: null },
      });
    });
  }

  /**
   * Manually create a master data for a branch. The branch is validated to
   * belong to the caller's tenant (CLAUDE.md §4.7), and the **main branch is
   * rejected** (it keeps only its auto-created default). Seed lab tests into the
   * new master data afterwards via the lab-test clone endpoint.
   * @param tenantId owning tenant
   * @param dto validated payload (branchId, name, optional description)
   * @returns the created master data
   * @throws BranchNotFoundException if the branch is missing/other tenant
   * @throws CannotCreateMasterDataForMainBranchException if the branch is the main branch
   * @throws MasterDataNameConflictException if the name is taken on this branch
   */
  async create(
    tenantId: string,
    dto: CreateMasterDataDto,
  ): Promise<MasterData> {
    // Validate the client-supplied branch belongs to this tenant (§4.7).
    await this.branchService.findById(dto.branchId, tenantId);

    if (await this.isMainBranch(tenantId, dto.branchId)) {
      throw new CannotCreateMasterDataForMainBranchException(dto.branchId);
    }

    try {
      return await this.prisma.masterData.create({
        data: {
          tenantId,
          branchId: dto.branchId,
          name: dto.name,
          description: dto.description ?? null,
        },
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new MasterDataNameConflictException(dto.name);
      }
      throw e;
    }
  }

  /**
   * Fetch one active master data scoped to its tenant.
   * @param id master data id
   * @param tenantId tenant scope
   * @throws MasterDataNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<MasterData> {
    const masterData = await this.prisma.masterData.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!masterData) {
      throw new MasterDataNotFoundException(id);
    }
    return masterData;
  }

  /**
   * List active master data for a tenant (offset pagination). Also feeds the
   * "copy data from" dropdown when seeding a new master data's lab tests.
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @param filters optional case-insensitive name `search` and a `branchId`
   *   filter (read filter only — tenant scoping + RLS guard cross-tenant access)
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
    filters: { search?: string; branchId?: string } = {},
  ): Promise<PaginatedResult<MasterData>> {
    const where: Prisma.MasterDataWhereInput = { tenantId, deletedAt: null };
    const search = filters.search?.trim();
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    // Sequential (not array-`$transaction`) so each call flows through the RLS
    // extension and carries the tenant GUC when RLS is enabled.
    const data = await this.prisma.masterData.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.masterData.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update a master data's name/description. `branchId` is immutable.
   * @param id master data id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws MasterDataNotFoundException if missing/soft-deleted
   * @throws MasterDataNameConflictException if the new name collides on this branch
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateMasterDataDto,
  ): Promise<MasterData> {
    await this.findById(id, tenantId);
    const data: Prisma.MasterDataUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined)
      data.description = dto.description ?? null;
    try {
      return await this.prisma.masterData.update({ where: { id }, data });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new MasterDataNameConflictException(dto.name ?? '');
      }
      throw e;
    }
  }

  /**
   * Soft-delete a master data and cascade soft-delete its active lab tests and
   * all of their children (samples, params, reference ranges/values) in one
   * transaction. Master data belonging to the tenant's main branch cannot be
   * deleted.
   * @param id master data id
   * @param tenantId tenant scope
   * @throws MasterDataNotFoundException if missing/soft-deleted
   * @throws CannotDeleteMainBranchMasterDataException if it belongs to the main branch
   */
  async remove(id: string, tenantId: string): Promise<MasterData> {
    const masterData = await this.findById(id, tenantId);
    if (await this.isMainBranch(tenantId, masterData.branchId)) {
      throw new CannotDeleteMainBranchMasterDataException(id);
    }
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      const labTests = await tx.labTest.findMany({
        where: { masterDataId: id, tenantId, deletedAt: null },
        select: { id: true },
      });
      const labTestIds = labTests.map((t) => t.id);
      if (labTestIds.length) {
        const childWhere = {
          labTestId: { in: labTestIds },
          tenantId,
          deletedAt: null,
        };
        await tx.labTestReferenceRange.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.labTestReferenceValue.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.labTestResultParam.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.labTestSample.updateMany({
          where: childWhere,
          data: { deletedAt: now },
        });
        await tx.labTest.updateMany({
          where: { id: { in: labTestIds }, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
      }
      return tx.masterData.update({
        where: { id },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Whether `branchId` is the tenant's current main branch (reads the single
   * `TenantMainBranch` pointer).
   * @param tenantId tenant scope
   * @param branchId the branch to check
   */
  private async isMainBranch(
    tenantId: string,
    branchId: string,
  ): Promise<boolean> {
    const pointer = await this.prisma.tenantMainBranch.findUnique({
      where: { tenantId },
    });
    return pointer?.branchId === branchId;
  }

  /**
   * Narrow an unknown caught error to a Prisma unique-constraint violation
   * (P2002). Used to map the per-branch name index to a typed 409.
   * @param e the caught error
   */
  private isUniqueViolation(
    e: unknown,
  ): e is Prisma.PrismaClientKnownRequestError {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    );
  }
}
