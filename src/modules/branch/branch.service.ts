import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Branch,
  BranchStatus,
  BranchType,
  Prisma,
  TenantMainBranch,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BranchModuleItemDto } from './dto/set-branch-modules.dto';
import { SYSTEM_MODULES } from '../permissions/constants/system-modules.constant';
import {
  BranchNameConflictException,
  BranchNotFoundException,
  CannotDeleteMainBranchException,
  InvalidReceivingBranchException,
  MainBranchNotSetException,
  NotACollectionCenterException,
} from './exceptions/branch.exceptions';

/** A sample-receiving branch mapped to a Collection Center. */
export interface CollectionMappingView {
  receivingBranchId: string;
  name: string;
  code: string;
  branchType: BranchType;
  status: BranchStatus;
}

/**
 * Branch management. Tenant-scoped: every query carries `tenantId` (defence in
 * depth on top of RLS — CLAUDE.md §4.3) and filters soft-deleted rows.
 */
@Injectable()
export class BranchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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
   * When `branchType` is `COLLECTION_CENTER`, the optional
   * `dto.receivingBranchIds` are mapped to the new branch in the same
   * transaction (branch + mappings are atomic). Each receiver is validated
   * first; supplying receivers for a non-Collection-Center branch is rejected.
   * @param tenantId owning tenant
   * @param dto validated branch payload (no `code` — it is generated here)
   * @param setBy person id of the actor, recorded on the main-branch pointer
   *   when auto-assignment fires (optional audit trail)
   * @returns the created branch
   * @throws BranchNameConflictException if the name is already used by an
   *   active branch in this tenant
   * @throws ValidationException if `receivingBranchIds` is set for a branch
   *   whose type is not `COLLECTION_CENTER`
   * @throws BranchNotFoundException / InvalidReceivingBranchException if a
   *   receiver is invalid (see {@link validateReceivingBranches})
   */
  async create(
    tenantId: string,
    dto: CreateBranchDto,
    setBy?: string,
  ): Promise<Branch> {
    const receivingBranchIds = dto.receivingBranchIds ?? [];
    if (receivingBranchIds.length > 0) {
      if (dto.branchType !== BranchType.COLLECTION_CENTER) {
        throw new ValidationException(
          'receivingBranchIds can only be set when branchType is COLLECTION_CENTER',
          { receivingBranchIds: 'only allowed for COLLECTION_CENTER branches' },
        );
      }
      // Validate every receiver up front (existence, tenant, active, not a CC).
      // No self-check: the new branch id is not yet known, so it cannot appear.
      await this.validateReceivingBranches(tenantId, receivingBranchIds);
    }

    try {
      const created = await this.prisma.withTenant(tenantId, async (tx) => {
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

        // Map the sample-receiving branches to this new Collection Center. All
        // ids were validated above and are unique (DTO `@ArrayUnique`), so a
        // plain createMany is safe (no existing rows to reactivate).
        if (receivingBranchIds.length > 0) {
          await tx.collectionCenterMapping.createMany({
            data: receivingBranchIds.map((receivingBranchId) => ({
              tenantId,
              collectionCenterId: branch.id,
              receivingBranchId,
            })),
          });
        }

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
      // Auto-provision the branch's default master data (and any other
      // branch-created side effects) via an in-process event. Listeners run in
      // their own transactions; a listener failure must not fail (or roll back)
      // the already-committed branch creation.
      await this.eventEmitter.emitAsync('branch.created', {
        tenantId,
        branchId: created.id,
        branchName: created.name,
      });
      return created;
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

  // ── Branch → Module enablement (User Management v2.0) ────────────────────────

  /**
   * List every system module with whether it is enabled at the branch. Modules
   * with no `branch_modules` row are reported as disabled.
   * @param tenantId tenant scope
   * @param branchId branch (validated to belong to the tenant)
   */
  async getBranchModules(
    tenantId: string,
    branchId: string,
  ): Promise<Array<{ moduleKey: string; label: string; isEnabled: boolean }>> {
    await this.findById(branchId, tenantId);
    const rows = await this.prisma.branchModule.findMany({
      where: { tenantId, branchId, deletedAt: null },
    });
    const enabled = new Map(rows.map((r) => [r.moduleKey, r.isEnabled]));
    return SYSTEM_MODULES.map((m) => ({
      moduleKey: m.key,
      label: m.label,
      isEnabled: enabled.get(m.key) ?? false,
    }));
  }

  /**
   * Set which system modules are enabled at a branch (upsert per module). The
   * client sends the desired set; modules default to enabled when `isEnabled`
   * is omitted.
   * @param tenantId tenant scope
   * @param branchId branch (validated to belong to the tenant)
   * @param items the modules to set
   * @returns the full module enablement list after the change
   */
  async setBranchModules(
    tenantId: string,
    branchId: string,
    items: BranchModuleItemDto[],
  ): Promise<Array<{ moduleKey: string; label: string; isEnabled: boolean }>> {
    await this.findById(branchId, tenantId);
    await this.prisma.withTenant(tenantId, async (tx) => {
      for (const item of items) {
        const isEnabled = item.isEnabled ?? true;
        await tx.branchModule.upsert({
          where: {
            branchId_moduleKey: { branchId, moduleKey: item.moduleKey },
          },
          create: {
            tenantId,
            branchId,
            moduleKey: item.moduleKey,
            isEnabled,
            deletedAt: null,
          },
          update: { isEnabled, deletedAt: null },
        });
      }
    });
    return this.getBranchModules(tenantId, branchId);
  }

  // ── Collection Center → sample-receiving branch mappings ─────────────────────

  /**
   * Validate that every id may receive samples from a Collection Center: each
   * must be an existing, active branch in the tenant, must not be the Collection
   * Center itself, and must not itself be a Collection Center.
   * @param tenantId tenant scope
   * @param receivingBranchIds candidate receiver ids
   * @param collectionCenterId the owning Collection Center when it already
   *   exists; omit during branch creation (the new id is not yet known, so a
   *   self-reference is impossible)
   * @throws BranchNotFoundException if a receiver is missing / other tenant
   * @throws InvalidReceivingBranchException if a receiver is the center itself or
   *   is another Collection Center
   */
  private async validateReceivingBranches(
    tenantId: string,
    receivingBranchIds: string[],
    collectionCenterId?: string,
  ): Promise<void> {
    for (const receivingBranchId of receivingBranchIds) {
      if (collectionCenterId && receivingBranchId === collectionCenterId) {
        throw new InvalidReceivingBranchException(
          receivingBranchId,
          'A collection center cannot map to itself',
        );
      }
      const receiver = await this.findById(receivingBranchId, tenantId);
      if (receiver.branchType === BranchType.COLLECTION_CENTER) {
        throw new InvalidReceivingBranchException(
          receivingBranchId,
          'Another collection center cannot be a sample receiver',
        );
      }
    }
  }

  /**
   * List the branches that receive samples from a Collection Center. Soft-deleted
   * receiver branches are omitted from the result.
   * @param tenantId tenant scope
   * @param branchId the Collection Center branch (validated to belong to the
   *   tenant and to be of type `COLLECTION_CENTER`)
   * @returns one entry per active mapped receiving branch
   * @throws BranchNotFoundException if the branch is missing / other tenant
   * @throws NotACollectionCenterException if the branch is not a Collection Center
   */
  async getCollectionMappings(
    tenantId: string,
    branchId: string,
  ): Promise<CollectionMappingView[]> {
    const center = await this.findById(branchId, tenantId);
    if (center.branchType !== BranchType.COLLECTION_CENTER) {
      throw new NotACollectionCenterException(branchId);
    }
    const mappings = await this.prisma.collectionCenterMapping.findMany({
      where: { tenantId, collectionCenterId: branchId, deletedAt: null },
    });
    if (mappings.length === 0) {
      return [];
    }
    const receivingIds = mappings.map((m) => m.receivingBranchId);
    const branches = await this.prisma.branch.findMany({
      where: { tenantId, id: { in: receivingIds }, deletedAt: null },
    });
    const byId = new Map(branches.map((b) => [b.id, b]));
    return mappings
      .map((m) => byId.get(m.receivingBranchId))
      .filter((b): b is Branch => b !== undefined)
      .map((b) => ({
        receivingBranchId: b.id,
        name: b.name,
        code: b.code,
        branchType: b.branchType,
        status: b.status,
      }));
  }

  /**
   * Replace the full set of sample-receiving branches mapped to a Collection
   * Center. Mappings no longer in the set are soft-deleted; ids in the set are
   * upserted (a previously soft-deleted mapping is reactivated rather than
   * duplicated, respecting the partial unique index in prisma/rls.sql). An empty
   * `receivingBranchIds` clears all mappings.
   *
   * Each receiver is validated against the caller's tenant (CLAUDE.md §4.7): it
   * must exist and be active, must not be the Collection Center itself, and must
   * not itself be a Collection Center.
   * @param tenantId tenant scope
   * @param collectionCenterId the Collection Center branch
   * @param receivingBranchIds the desired set of receiving branch ids
   * @param actorId person id of the actor (reserved for future audit trail)
   * @returns the mappings after the change
   * @throws BranchNotFoundException if the center or any receiver is missing /
   *   other tenant
   * @throws NotACollectionCenterException if the branch is not a Collection Center
   * @throws InvalidReceivingBranchException if a receiver is the center itself or
   *   is another Collection Center
   */
  async setCollectionMappings(
    tenantId: string,
    collectionCenterId: string,
    receivingBranchIds: string[],
    actorId?: string,
  ): Promise<CollectionMappingView[]> {
    void actorId;
    const center = await this.findById(collectionCenterId, tenantId);
    if (center.branchType !== BranchType.COLLECTION_CENTER) {
      throw new NotACollectionCenterException(collectionCenterId);
    }

    // Validate every receiver before touching the database.
    await this.validateReceivingBranches(
      tenantId,
      receivingBranchIds,
      collectionCenterId,
    );

    await this.prisma.withTenant(tenantId, async (tx) => {
      // Soft-delete active mappings that are no longer in the desired set.
      // (`notIn: []` matches every row, so an empty set clears all mappings.)
      await tx.collectionCenterMapping.updateMany({
        where: {
          tenantId,
          collectionCenterId,
          deletedAt: null,
          receivingBranchId: { notIn: receivingBranchIds },
        },
        data: { deletedAt: new Date() },
      });

      // Upsert each desired mapping (reactivate a soft-deleted row, else create).
      for (const receivingBranchId of receivingBranchIds) {
        const existing = await tx.collectionCenterMapping.findFirst({
          where: { tenantId, collectionCenterId, receivingBranchId },
        });
        if (existing) {
          await tx.collectionCenterMapping.update({
            where: { id: existing.id },
            data: { deletedAt: null },
          });
        } else {
          await tx.collectionCenterMapping.create({
            data: { tenantId, collectionCenterId, receivingBranchId },
          });
        }
      }
    });

    return this.getCollectionMappings(tenantId, collectionCenterId);
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
