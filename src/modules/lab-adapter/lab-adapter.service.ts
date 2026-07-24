import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { LabAdapter, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { EquipmentService } from '../equipment/equipment.service';
import { CreateLabAdapterDto } from './dto/create-lab-adapter.dto';
import { UpdateLabAdapterDto } from './dto/update-lab-adapter.dto';
import { ListLabAdapterQueryDto } from './dto/list-lab-adapter-query.dto';
import {
  LabAdapterBranchRef,
  LabAdapterLabTestRef,
  LabAdapterListRow,
  LabAdapterWithRelations,
} from './entities/lab-adapter.entity';
import {
  LabAdapterBranchNotFoundException,
  LabAdapterEquipmentNotFoundException,
  LabAdapterLabTestNotFoundException,
  LabAdapterNameConflictException,
  LabAdapterNotFoundException,
} from './exceptions/lab-adapter.exceptions';

/**
 * Lab Adapters — a tenant's instrument-integration bridges. Tenant-scoped,
 * tenant-level (CLAUDE.md §4.6): the adapter belongs to the business as a whole
 * and is assigned to N branches via `LabAdapterBranch`; it references a global
 * (SITE_ADMIN) `Equipment` and maps the branch lab tests it reports via
 * `LabAdapterTest`. Tenant comes from the JWT (never the body); reads always
 * filter `{ tenantId, deletedAt: null }`. A unique `token` is system-generated on
 * create. Multi-row writes run in `withTenant` transactions (RLS context + one
 * atomic unit). Equipment and branch references are validated through their
 * owning services (DI); branch-lab-test references are validated against the
 * tenant-scoped `BranchLabTest` model directly.
 */
@Injectable()
export class LabAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
    private readonly equipmentService: EquipmentService,
  ) {}

  /**
   * Create a lab adapter with its branch assignments and lab-test mappings in one
   * transaction. A unique `token` is generated server-side. The referenced
   * equipment, every branch, and every branch lab test are validated first.
   * @param tenantId tenant scope (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto validated payload (identity + equipmentId + branchIds + labTestIds)
   * @returns the created adapter composed with equipment + branches + lab tests
   * @throws LabAdapterEquipmentNotFoundException if the equipment ref is invalid
   * @throws LabAdapterBranchNotFoundException if any branch ref is invalid
   * @throws LabAdapterLabTestNotFoundException if any lab-test ref is invalid
   * @throws LabAdapterNameConflictException if the name is already taken
   */
  async create(
    tenantId: string,
    actorId: string | null,
    dto: CreateLabAdapterDto,
  ): Promise<LabAdapterWithRelations> {
    await this.assertEquipmentRef(dto.equipmentId);
    await this.assertBranchRefs(tenantId, dto.branchIds);
    const labTestIds = dto.labTestIds ?? [];
    await this.assertBranchLabTestRefs(tenantId, labTestIds);

    const token = this.generateToken();
    let createdId: string;
    try {
      createdId = await this.prisma.withTenant(tenantId, async (tx) => {
        const adapter = await tx.labAdapter.create({
          data: {
            tenantId,
            name: dto.name,
            token,
            equipmentId: dto.equipmentId,
            isActive: dto.isActive ?? true,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
        await this.createBranchRows(tx, tenantId, adapter.id, dto.branchIds);
        await this.createTestRows(tx, tenantId, adapter.id, labTestIds);
        return adapter.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.name);
      throw e;
    }
    return this.findById(createdId, tenantId);
  }

  /**
   * List the tenant's lab adapters (paginated + search + status). Each row carries
   * the referenced equipment name and the counts of assigned branches / mapped
   * tests.
   * @param tenantId tenant scope (from JWT)
   * @param query search + status + pagination
   */
  async findAll(
    tenantId: string,
    query: ListLabAdapterQueryDto,
  ): Promise<PaginatedResult<LabAdapterListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.LabAdapterWhereInput = { tenantId, deletedAt: null };
    const term = query.search?.trim();
    if (term) {
      where.name = { contains: term, mode: 'insensitive' };
    }
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }

    const [adapters, total] = await Promise.all([
      this.prisma.labAdapter.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.labAdapter.count({ where }),
    ]);

    const ids = adapters.map((a) => a.id);
    const [branchCounts, testCounts, equipmentNames] = await Promise.all([
      this.countBranchesByAdapter(tenantId, ids),
      this.countTestsByAdapter(tenantId, ids),
      this.resolveEquipmentNames(adapters.map((a) => a.equipmentId)),
    ]);

    const data: LabAdapterListRow[] = adapters.map((a) => ({
      id: a.id,
      name: a.name,
      token: a.token,
      isActive: a.isActive,
      equipmentName: equipmentNames.get(a.equipmentId) ?? null,
      branchCount: branchCounts.get(a.id) ?? 0,
      labTestsCount: testCounts.get(a.id) ?? 0,
    }));
    return { data, total, page, limit };
  }

  /**
   * Fetch one lab adapter composed with its referenced equipment, assigned
   * branches (with names), and mapped branch lab tests (in mapping order).
   * @param id adapter id
   * @param tenantId tenant scope (from JWT)
   * @throws LabAdapterNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<LabAdapterWithRelations> {
    const adapter = await this.findCoreById(id, tenantId);
    const [equipment, branches, labTests] = await Promise.all([
      this.resolveEquipment(adapter.equipmentId),
      this.resolveBranches(tenantId, id),
      this.resolveLabTests(tenantId, id),
    ]);
    return { ...adapter, equipment, branches, labTests };
  }

  /**
   * Update a lab adapter. Provided scalar fields are patched; when `branchIds` or
   * `labTestIds` is provided that whole set is replaced (old active rows
   * soft-deleted, the new set created) in one transaction. References are
   * validated first.
   * @param id adapter id
   * @param tenantId tenant scope (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto partial update
   * @throws LabAdapterNotFoundException if missing/soft-deleted/other tenant
   * @throws LabAdapterEquipmentNotFoundException / LabAdapterBranchNotFoundException
   *   / LabAdapterLabTestNotFoundException on invalid refs
   * @throws LabAdapterNameConflictException if the name is already taken
   */
  async update(
    id: string,
    tenantId: string,
    actorId: string | null,
    dto: UpdateLabAdapterDto,
  ): Promise<LabAdapterWithRelations> {
    await this.findCoreById(id, tenantId);
    if (dto.equipmentId !== undefined) {
      await this.assertEquipmentRef(dto.equipmentId);
    }
    if (dto.branchIds !== undefined) {
      await this.assertBranchRefs(tenantId, dto.branchIds);
    }
    if (dto.labTestIds !== undefined) {
      await this.assertBranchLabTestRefs(tenantId, dto.labTestIds);
    }

    const data: Prisma.LabAdapterUpdateInput = { updatedBy: actorId };
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.equipmentId !== undefined) {
      data.equipmentId = dto.equipmentId;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    const now = new Date();
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.labAdapter.update({ where: { id }, data });
        if (dto.branchIds !== undefined) {
          await tx.labAdapterBranch.updateMany({
            where: { labAdapterId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createBranchRows(tx, tenantId, id, dto.branchIds);
        }
        if (dto.labTestIds !== undefined) {
          await tx.labAdapterTest.updateMany({
            where: { labAdapterId: id, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createTestRows(tx, tenantId, id, dto.labTestIds);
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.name ?? '');
      throw e;
    }
    return this.findById(id, tenantId);
  }

  /**
   * Soft-delete a lab adapter and cascade soft-delete its branch/test rows, in one
   * transaction.
   * @param id adapter id
   * @param tenantId tenant scope (from JWT)
   * @throws LabAdapterNotFoundException if missing/soft-deleted/other tenant
   */
  async remove(id: string, tenantId: string): Promise<LabAdapter> {
    await this.findCoreById(id, tenantId);
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.labAdapterBranch.updateMany({
        where: { labAdapterId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.labAdapterTest.updateMany({
        where: { labAdapterId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.labAdapter.update({ where: { id }, data: { deletedAt: now } });
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Fetch one active adapter (core row only), tenant-scoped.
   * @throws LabAdapterNotFoundException if missing/soft-deleted/other tenant
   */
  private async findCoreById(
    id: string,
    tenantId: string,
  ): Promise<LabAdapter> {
    const adapter = await this.prisma.labAdapter.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!adapter) {
      throw new LabAdapterNotFoundException(id);
    }
    return adapter;
  }

  /** Generate a unique, opaque adapter token (64 hex chars). */
  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Validate that `equipmentId` references an active global equipment.
   * @throws LabAdapterEquipmentNotFoundException if invalid
   */
  private async assertEquipmentRef(equipmentId: string): Promise<void> {
    try {
      await this.equipmentService.findById(equipmentId);
    } catch {
      throw new LabAdapterEquipmentNotFoundException(equipmentId);
    }
  }

  /**
   * Validate that every id references an active branch of the caller's tenant
   * (verified via `BranchService`, never trusting the client id — CLAUDE.md §4.7).
   * @throws LabAdapterBranchNotFoundException listing the invalid ids
   */
  private async assertBranchRefs(
    tenantId: string,
    branchIds: string[],
  ): Promise<void> {
    if (!branchIds.length) {
      return;
    }
    const missing: string[] = [];
    for (const branchId of branchIds) {
      try {
        await this.branchService.findById(branchId, tenantId);
      } catch {
        missing.push(branchId);
      }
    }
    if (missing.length) {
      throw new LabAdapterBranchNotFoundException(missing);
    }
  }

  /**
   * Validate that every id references an active branch lab test of the caller's
   * tenant.
   * @throws LabAdapterLabTestNotFoundException listing the invalid ids
   */
  private async assertBranchLabTestRefs(
    tenantId: string,
    labTestIds: string[],
  ): Promise<void> {
    if (!labTestIds.length) {
      return;
    }
    const unique = [...new Set(labTestIds)];
    const found = await this.prisma.branchLabTest.findMany({
      where: { id: { in: unique }, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      const foundIds = new Set(found.map((t) => t.id));
      const missing = unique.filter((id) => !foundIds.has(id));
      throw new LabAdapterLabTestNotFoundException(missing);
    }
  }

  /** Insert an adapter's branch-assignment rows (no-op for an empty list). */
  private async createBranchRows(
    tx: Prisma.TransactionClient,
    tenantId: string,
    labAdapterId: string,
    branchIds: string[],
  ): Promise<void> {
    if (!branchIds.length) {
      return;
    }
    await tx.labAdapterBranch.createMany({
      data: branchIds.map((branchId) => ({
        tenantId,
        labAdapterId,
        branchId,
      })),
    });
  }

  /** Insert an adapter's lab-test mapping rows (no-op for an empty list). */
  private async createTestRows(
    tx: Prisma.TransactionClient,
    tenantId: string,
    labAdapterId: string,
    labTestIds: string[],
  ): Promise<void> {
    if (!labTestIds.length) {
      return;
    }
    await tx.labAdapterTest.createMany({
      data: labTestIds.map((branchLabTestId, index) => ({
        tenantId,
        labAdapterId,
        branchLabTestId,
        sortOrder: index,
      })),
    });
  }

  /** Resolve one equipment to its `{ id, name, code }` projection (or null). */
  private async resolveEquipment(
    equipmentId: string,
  ): Promise<LabAdapterWithRelations['equipment']> {
    return this.prisma.equipment.findFirst({
      where: { id: equipmentId, deletedAt: null },
      select: { id: true, name: true, code: true },
    });
  }

  /** Resolve an adapter's active branch assignments to `{ branchId, branchName }`. */
  private async resolveBranches(
    tenantId: string,
    labAdapterId: string,
  ): Promise<LabAdapterBranchRef[]> {
    const rows = await this.prisma.labAdapterBranch.findMany({
      where: { labAdapterId, tenantId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { branchId: true },
    });
    const branchIds = rows.map((r) => r.branchId);
    if (!branchIds.length) {
      return [];
    }
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const nameById = new Map(branches.map((b) => [b.id, b.name]));
    return branchIds.map((branchId) => ({
      branchId,
      branchName: nameById.get(branchId) ?? '',
    }));
  }

  /** Resolve an adapter's active mapped tests to `{ id, testName, testCode }`. */
  private async resolveLabTests(
    tenantId: string,
    labAdapterId: string,
  ): Promise<LabAdapterLabTestRef[]> {
    const rows = await this.prisma.labAdapterTest.findMany({
      where: { labAdapterId, tenantId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { branchLabTestId: true },
    });
    const testIds = rows.map((r) => r.branchLabTestId);
    if (!testIds.length) {
      return [];
    }
    const tests = await this.prisma.branchLabTest.findMany({
      where: { id: { in: testIds }, tenantId, deletedAt: null },
      select: { id: true, testName: true, testCode: true },
    });
    const byId = new Map(tests.map((t) => [t.id, t]));
    return testIds
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .map((t) => ({ id: t.id, testName: t.testName, testCode: t.testCode }));
  }

  /** Count active branch assignments per adapter, keyed by `labAdapterId`. */
  private async countBranchesByAdapter(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!ids.length) {
      return map;
    }
    const grouped = await this.prisma.labAdapterBranch.groupBy({
      by: ['labAdapterId'],
      where: { labAdapterId: { in: ids }, tenantId, deletedAt: null },
      _count: { _all: true },
    });
    for (const g of grouped) {
      map.set(g.labAdapterId, g._count._all);
    }
    return map;
  }

  /** Count active mapped tests per adapter, keyed by `labAdapterId`. */
  private async countTestsByAdapter(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!ids.length) {
      return map;
    }
    const grouped = await this.prisma.labAdapterTest.groupBy({
      by: ['labAdapterId'],
      where: { labAdapterId: { in: ids }, tenantId, deletedAt: null },
      _count: { _all: true },
    });
    for (const g of grouped) {
      map.set(g.labAdapterId, g._count._all);
    }
    return map;
  }

  /** Resolve a set of equipment ids to their names, keyed by id. */
  private async resolveEquipmentNames(
    ids: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = [...new Set(ids)];
    if (!unique.length) {
      return map;
    }
    const rows = await this.prisma.equipment.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    for (const r of rows) {
      map.set(r.id, r.name);
    }
    return map;
  }

  /**
   * Map a Prisma unique-constraint violation (P2002) on the adapter name to the
   * typed 409; rethrow anything else.
   */
  private rethrowConflict(e: unknown, name: string): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new LabAdapterNameConflictException(name);
    }
  }
}
