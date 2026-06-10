import { Injectable } from '@nestjs/common';
import { Branch, BranchStatus, Prisma, TenantMainBranch } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import {
  BranchNameConflictException,
  BranchNotFoundException,
  CannotDeleteMainBranchException,
  MainBranchNotSetException,
} from './exceptions/branch.exceptions';

/**
 * Branch management. Tenant-scoped: every query carries `tenantId` (defence in
 * depth on top of RLS — CLAUDE.md §4.3) and filters soft-deleted rows.
 */
@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a branch within a tenant. The branch `code` is system-generated:
   * a per-tenant sequential value (`BR-00001`, `BR-00002`, …) derived by
   * atomically incrementing `Tenant.branchCounter` in the same transaction, so
   * concurrent creates never collide. `code` is immutable thereafter.
   *
   * Main-branch auto-assignment: if the new branch is active
   * (`status = ACTIVE`) and the tenant has no other active branch
   * (`deletedAt = null` AND `status = ACTIVE`), the new branch is set as the
   * tenant's main branch in the same transaction.
   * @param tenantId owning tenant
   * @param dto validated branch payload (no `code` — it is generated here)
   * @param setBy person id of the actor, recorded on the main-branch pointer
   *   when auto-assignment fires (optional audit trail)
   * @returns the created branch
   * @throws BranchNameConflictException if the name is already used by an
   *   active branch in this tenant
   */
  async create(
    tenantId: string,
    dto: CreateBranchDto,
    setBy?: string,
  ): Promise<Branch> {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { branchCounter: { increment: 1 } },
          select: { branchCounter: true },
        });
        const code = `BR-${String(tenant.branchCounter).padStart(5, '0')}`;
        const branch = await tx.branch.create({
          data: {
            tenantId,
            name: dto.name,
            branchType: dto.branchType,
            code,
            status: dto.status ?? BranchStatus.ACTIVE,
            establishedDate: dto.establishedDate
              ? new Date(dto.establishedDate)
              : null,
            addressLine: dto.addressLine ?? null,
            city: dto.city ?? null,
            state: dto.state ?? null,
            pincode: dto.pincode ?? null,
            phone: dto.phone ?? null,
            email: dto.email ?? null,
            managerName: dto.managerName ?? null,
            managerPhone: dto.managerPhone ?? null,
            labDirector: dto.labDirector ?? null,
            openingTime: dto.openingTime ?? null,
            closingTime: dto.closingTime ?? null,
            dailyCapacity: dto.dailyCapacity ?? null,
            operationalDays: dto.operationalDays ?? [],
            gstNo: dto.gstNo ?? null,
            licenseNo: dto.licenseNo ?? null,
            remarks: dto.remarks ?? null,
          },
        });

        // Auto-set as main branch when this is the tenant's only active branch.
        // An active branch = not soft-deleted AND status ACTIVE; a count of 1
        // therefore means the branch we just created is the sole active one.
        if (branch.status === BranchStatus.ACTIVE) {
          const activeCount = await tx.branch.count({
            where: { tenantId, deletedAt: null, status: BranchStatus.ACTIVE },
          });
          if (activeCount === 1) {
            // Upsert (not create) so any stale pointer self-heals.
            await tx.tenantMainBranch.upsert({
              where: { tenantId },
              create: { tenantId, branchId: branch.id, setBy: setBy ?? null },
              update: { branchId: branch.id, setBy: setBy ?? null },
            });
          }
        }

        return branch;
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new BranchNameConflictException(dto.name);
      }
      throw e;
    }
  }

  /**
   * Fetch one active branch scoped to its tenant.
   * @param id branch id
   * @param tenantId tenant scope
   * @throws BranchNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<Branch> {
    const branch = await this.prisma.branch.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!branch) {
      throw new BranchNotFoundException(id);
    }
    return branch;
  }

  /**
   * List active branches for a tenant (offset pagination).
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   */
  async findAllForTenant(
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<Branch>> {
    const where = { tenantId, deletedAt: null };
    // Sequential (not array-`$transaction`) so each call flows through the RLS
    // extension and carries the tenant GUC when RLS is enabled.
    const data = await this.prisma.branch.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.branch.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update an existing branch. `code` is immutable and cannot be changed.
   * If the branch is set to `INACTIVE` and it is the tenant's main branch, its
   * main-branch pointer is cleared in the same transaction (a non-active branch
   * may not remain the main branch).
   * @param id branch id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws BranchNotFoundException if missing/soft-deleted
   * @throws BranchNameConflictException if the new name collides with another
   *   active branch in this tenant
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateBranchDto,
  ): Promise<Branch> {
    await this.findById(id, tenantId);
    const data: Prisma.BranchUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.branchType !== undefined) data.branchType = dto.branchType;
    // `code` is immutable and system-generated — never updated here.
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.establishedDate !== undefined) {
      data.establishedDate = dto.establishedDate
        ? new Date(dto.establishedDate)
        : null;
    }
    if (dto.addressLine !== undefined)
      data.addressLine = dto.addressLine ?? null;
    if (dto.city !== undefined) data.city = dto.city ?? null;
    if (dto.state !== undefined) data.state = dto.state ?? null;
    if (dto.pincode !== undefined) data.pincode = dto.pincode ?? null;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.managerName !== undefined)
      data.managerName = dto.managerName ?? null;
    if (dto.managerPhone !== undefined) {
      data.managerPhone = dto.managerPhone ?? null;
    }
    if (dto.labDirector !== undefined)
      data.labDirector = dto.labDirector ?? null;
    if (dto.openingTime !== undefined)
      data.openingTime = dto.openingTime ?? null;
    if (dto.closingTime !== undefined)
      data.closingTime = dto.closingTime ?? null;
    if (dto.dailyCapacity !== undefined) {
      data.dailyCapacity = dto.dailyCapacity ?? null;
    }
    if (dto.operationalDays !== undefined) {
      data.operationalDays = dto.operationalDays ?? [];
    }
    if (dto.gstNo !== undefined) data.gstNo = dto.gstNo ?? null;
    if (dto.licenseNo !== undefined) data.licenseNo = dto.licenseNo ?? null;
    if (dto.remarks !== undefined) data.remarks = dto.remarks ?? null;
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const updated = await tx.branch.update({ where: { id }, data });
        // Deactivating the main branch releases its pointer; deleteMany is a
        // safe no-op when this branch is not the main branch.
        if (dto.status === BranchStatus.INACTIVE) {
          await tx.tenantMainBranch.deleteMany({
            where: { tenantId, branchId: id },
          });
        }
        return updated;
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw new BranchNameConflictException(dto.name ?? '');
      }
      throw e;
    }
  }

  /**
   * Soft-delete a branch (sets deletedAt; row is preserved). The tenant's main
   * branch cannot be deleted — set another branch as main, or deactivate it
   * (which releases the main-branch pointer), first.
   * @param id branch id
   * @param tenantId tenant scope
   * @throws BranchNotFoundException if missing/soft-deleted
   * @throws CannotDeleteMainBranchException if the branch is the current main branch
   */
  async remove(id: string, tenantId: string): Promise<Branch> {
    await this.findById(id, tenantId);
    const pointer = await this.prisma.tenantMainBranch.findUnique({
      where: { tenantId },
    });
    if (pointer?.branchId === id) {
      throw new CannotDeleteMainBranchException(id);
    }
    return this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Set (or change) the tenant's single main branch. Idempotent: there is at
   * most one main-branch row per tenant (`tenant_id` is unique), so this
   * upserts. The branch is validated to belong to the caller's tenant first
   * (CLAUDE.md §4.7 — client-supplied branch ids are never trusted).
   * @param tenantId tenant scope
   * @param branchId the branch to mark as main
   * @param setBy person id of the actor (optional audit trail)
   * @returns the main-branch pointer row
   * @throws BranchNotFoundException if the branch is missing/soft-deleted/other tenant
   */
  async setMainBranch(
    tenantId: string,
    branchId: string,
    setBy?: string,
  ): Promise<TenantMainBranch> {
    await this.findById(branchId, tenantId);
    return this.prisma.tenantMainBranch.upsert({
      where: { tenantId },
      create: { tenantId, branchId, setBy: setBy ?? null },
      update: { branchId, setBy: setBy ?? null },
    });
  }

  /**
   * Fetch the tenant's current main branch.
   * @param tenantId tenant scope
   * @returns the main branch
   * @throws MainBranchNotSetException if no main branch has been set
   * @throws BranchNotFoundException if the main branch was since soft-deleted
   */
  async getMainBranch(tenantId: string): Promise<Branch> {
    const pointer = await this.prisma.tenantMainBranch.findUnique({
      where: { tenantId },
    });
    if (!pointer) {
      throw new MainBranchNotSetException(tenantId);
    }
    return this.findById(pointer.branchId, tenantId);
  }

  /**
   * Narrow an unknown caught error to a Prisma unique-constraint violation
   * (P2002). Used to map the per-tenant branch-name index to a typed 409.
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
