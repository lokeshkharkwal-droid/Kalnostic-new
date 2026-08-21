import { Injectable } from '@nestjs/common';
import { BranchLabTest, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from '../lab-test/lab-test.service';
import { BranchLabTestListService } from '../branch-lab-test-list/branch-lab-test-list.service';
import { LabTestWithChildren } from '../lab-test/entities/lab-test.entity';
import { LabTestNotFoundException } from '../lab-test/exceptions/lab-test.exceptions';
import { ImportBranchLabTestsDto } from './dto/import-branch-lab-tests.dto';
import { SyncBranchLabTestsDto } from './dto/sync-branch-lab-tests.dto';
import { ListBranchLabTestsQueryDto } from './dto/list-branch-lab-tests-query.dto';
import { UpdateBranchLabTestDto } from './dto/update-branch-lab-test.dto';
import { BulkEditBranchLabTestsDto } from './dto/bulk-edit-branch-lab-tests.dto';
import {
  BranchLabTestDefaultConflictException,
  BranchLabTestNotFoundException,
} from './exceptions/branch-lab-test.exceptions';
import {
  BranchLabTestConfigSnapshot,
  BranchLabTestImportResult,
  BranchLabTestListRow,
  BranchLabTestSyncResult,
} from './entities/branch-lab-test.entity';

/** Result of a bulk-edit: the number of branch lab tests updated. */
export interface BranchLabTestBulkEditResult {
  updated: number;
}

/** A Create-Order lab-test option row (Diagnostic Items table). */
export interface BranchLabTestOption {
  id: string;
  name: string;
  price: number;
  sampleType: string | null;
  isFasting: boolean;
}

/** The scope/actor a source Master Data test is materialized into. */
interface ImportTarget {
  tenantId: string;
  branchId: string;
  sourceMasterDataId: string;
  /** The pricing list the copy belongs to (each list owns its rows). */
  listId: string;
  actorId: string | null;
}

/**
 * Source keys that are re-derived (never copied) or folded into `configSnapshot`
 * when materializing a branch lab test from a composed Master Data test.
 */
const BRANCH_TEST_DROP_KEYS = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'source',
  // Master Data provenance columns that don't exist on BranchLabTest — must be
  // dropped or Prisma rejects them as unknown args on create/update.
  'clonedFromId',
  'templateSyncedAt',
  'sourceMasterLabTestId',
  'versionHistory',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'samples',
  'resultParams',
];

/**
 * A branch's operational **Lab Test List** — materialized, independent snapshots
 * copied from the branch's Master Data lab tests. Tenant-scoped + branch-level;
 * tenant/branch come from the JWT (never the body). Import copies selected Master
 * Data tests (deep clinical config folded into `configSnapshot`); sync overwrites
 * copies from their source; edits here never propagate back to Master Data.
 * Prisma-direct; multi-row writes run in `withTenant` transactions. Source rows
 * are always composed BEFORE opening a `withTenant` tx (nested service reads need
 * the per-op RLS GUC, which a `withTenant` connection does not expose to them).
 */
@Injectable()
export class BranchLabTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: MasterDataService,
    private readonly labTestService: LabTestService,
    private readonly listService: BranchLabTestListService,
  ) {}

  /**
   * Persist-import the selected Master Data lab tests into the active branch's
   * Lab Test List. Each source (of the branch's 1:1 master data) is deep-copied
   * as the group's imported original (`isDefault=true`, `isDuplicate=false`) with
   * a fresh id and its clinical children snapshotted into `configSnapshot`.
   * Idempotent: a source whose variant group already has an active row (matched
   * by `sourceLabTestId`) is skipped, as is any id not found in the branch's
   * master data. Copies run in one transaction.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the source lab-test ids to import
   * @returns counts of copied vs skipped tests
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   */
  async importFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: ImportBranchLabTestsDto,
  ): Promise<BranchLabTestImportResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    // Import always lands in the branch's default (Walk-in) list — created here on
    // the very first import (Phase 1).
    const walkIn = await this.listService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const validSources = await this.prisma.labTest.findMany({
      where: {
        id: { in: dto.labTestIds },
        masterDataId: masterData.id,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const validIds = validSources.map((s) => s.id);
    // Existing Walk-in rows for these sources are UPDATED (re-snapshot); new ones
    // are ADDED — never duplicated (Phase 1: update existing / add new / no dup).
    const existing = await this.prisma.branchLabTest.findMany({
      where: {
        tenantId,
        branchId,
        listId: walkIn.id,
        deletedAt: null,
        sourceLabTestId: { in: validIds },
      },
      select: { id: true, sourceLabTestId: true },
    });
    const existingBySource = new Map(
      existing.map((t) => [t.sourceLabTestId, t.id] as const),
    );

    const toCreate: Prisma.BranchLabTestUncheckedCreateInput[] = [];
    const toUpdate: {
      id: string;
      data: Prisma.BranchLabTestUncheckedUpdateInput;
    }[] = [];
    const skipped = dto.labTestIds.length - validIds.length;
    for (const id of validIds) {
      const source = await this.labTestService.findById(
        masterData.id,
        id,
        tenantId,
      );
      const existingId = existingBySource.get(id);
      if (existingId) {
        toUpdate.push({
          id: existingId,
          data: this.buildSyncData(source, actorId),
        });
      } else {
        toCreate.push(
          this.buildImportData(source, {
            tenantId,
            branchId,
            sourceMasterDataId: masterData.id,
            listId: walkIn.id,
            actorId,
          }),
        );
      }
    }

    if (toCreate.length || toUpdate.length) {
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          for (const data of toCreate) {
            await tx.branchLabTest.create({ data });
          }
          for (const u of toUpdate) {
            await tx.branchLabTest.update({
              where: { id: u.id },
              data: u.data,
            });
          }
        });
      } catch (e) {
        this.rethrowConflict(e);
        throw e;
      }
    }
    return { copied: toCreate.length, updated: toUpdate.length, skipped };
  }

  /**
   * Re-snapshot branch lab tests from their source Master Data tests. Reloads
   * each copy's source (via `sourceLabTestId`) and OVERWRITES the copy's parent
   * fields and clinical snapshot with the current Master Data values — any
   * branch-level edits are discarded (agreed overwrite contract). Copies whose
   * source is missing/soft-deleted are left untouched and counted as skipped.
   * Updates run in one transaction.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto optional subset of branch-lab-test ids to sync (omit = all)
   * @returns counts of synced vs skipped copies
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   */
  async syncFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: SyncBranchLabTestsDto,
  ): Promise<BranchLabTestSyncResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    // Sync only refreshes the default (Walk-in) list — the one connected to Master
    // Data. Non-default pricing lists are managed independently of master data.
    const walkIn = await this.listService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const where: Prisma.BranchLabTestWhereInput = {
      tenantId,
      branchId,
      listId: walkIn.id,
      deletedAt: null,
      // Only imported originals are re-snapshotted; user duplicates keep their
      // independent edits (agreed sync contract).
      isDuplicate: false,
      sourceLabTestId: { not: null },
    };
    if (dto.branchLabTestIds?.length) {
      where.id = { in: dto.branchLabTestIds };
    }
    const copies = await this.prisma.branchLabTest.findMany({
      where,
      select: { id: true, sourceLabTestId: true },
    });

    const updates: {
      id: string;
      data: Prisma.BranchLabTestUncheckedUpdateInput;
    }[] = [];
    let skipped = 0;
    for (const copy of copies) {
      if (!copy.sourceLabTestId) {
        skipped += 1;
        continue;
      }
      try {
        const source = await this.labTestService.findById(
          masterData.id,
          copy.sourceLabTestId,
          tenantId,
        );
        updates.push({
          id: copy.id,
          data: this.buildSyncData(source, actorId),
        });
      } catch (e) {
        if (e instanceof LabTestNotFoundException) {
          skipped += 1;
          continue;
        }
        throw e;
      }
    }

    if (updates.length) {
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          for (const u of updates) {
            await tx.branchLabTest.update({
              where: { id: u.id },
              data: u.data,
            });
          }
        });
      } catch (e) {
        this.rethrowConflict(e);
        throw e;
      }
    }
    return { synced: updates.length, skipped };
  }

  /**
   * List the branch's Lab Test List (paginated). Supports a case-insensitive
   * `search` on testName/testCode and an active `status` filter.
   * @param tenantId tenant scope
   * @param branchId active branch
   * @param query pagination + filters
   */
  async findAll(
    tenantId: string,
    branchId: string,
    query: ListBranchLabTestsQueryDto,
  ): Promise<PaginatedResult<BranchLabTestListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.BranchLabTestWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
    // Scope to a specific pricing list (a tab). Omitted = the branch's Walk-in list.
    where.listId =
      query.listId ?? (await this.resolveListId(tenantId, branchId));
    const term = query.search?.trim();
    if (term) {
      where.OR = [
        { testName: { contains: term, mode: 'insensitive' } },
        { testCode: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }
    const [data, total] = await Promise.all([
      this.prisma.branchLabTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { testName: 'asc' },
      }),
      this.prisma.branchLabTest.count({ where }),
    ]);
    const [deptNames, catNames, subCatNames] = await Promise.all([
      this.resolveNames(
        'department',
        tenantId,
        data.map((t) => t.departmentId),
      ),
      this.resolveNames(
        'category',
        tenantId,
        data.map((t) => t.categoryId),
      ),
      this.resolveNames(
        'subCategory',
        tenantId,
        data.map((t) => t.subCategoryId),
      ),
    ]);
    const enriched: BranchLabTestListRow[] = data.map((t) => ({
      ...t,
      departmentName: this.nameOf(deptNames, t.departmentId),
      categoryName: this.nameOf(catNames, t.categoryId),
      subCategoryName: this.nameOf(subCatNames, t.subCategoryId),
      sampleSummary:
        (t.configSnapshot as unknown as BranchLabTestConfigSnapshot)?.samples
          ?.map((s) => s.sampleType)
          .filter(Boolean)
          .join(', ') || null,
    }));
    return { data: enriched, total, page, limit };
  }

  /**
   * Resolve a set of classification ids to a `id → name` map (tenant-scoped).
   * Used to denormalise department/category/sub-category names into list rows.
   */
  private async resolveNames(
    model: 'department' | 'category' | 'subCategory',
    tenantId: string,
    idsRaw: (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(idsRaw.filter((x): x is string => Boolean(x)))];
    const map = new Map<string, string>();
    if (ids.length === 0) {
      return map;
    }
    const where = { id: { in: ids }, tenantId };
    const select = { id: true, name: true };
    const rows =
      model === 'department'
        ? await this.prisma.department.findMany({ where, select })
        : model === 'category'
          ? await this.prisma.category.findMany({ where, select })
          : await this.prisma.subCategory.findMany({ where, select });
    for (const r of rows) {
      map.set(r.id, r.name);
    }
    return map;
  }

  /** Look up a resolved name by (possibly null) id. */
  private nameOf(map: Map<string, string>, id: string | null): string | null {
    return id ? (map.get(id) ?? null) : null;
  }

  /**
   * Lightweight `{ id, name, price, sampleType, isFasting }` options for the
   * Create-Order lab-test selector. Returns the branch's **active default-variant**
   * rows only (one orderable row per variant group), so a selected id is directly
   * usable as an order item's `branchLabTestId`. `price` is the list price
   * (`priceMsrp`, minor units); `sampleType`/`isFasting` come from the first sample
   * in `configSnapshot` — both feed the form's Diagnostic Items table. Supports a
   * case-insensitive `search` on testName.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param filters optional search + offset pagination
   * @returns full option array when `page` is omitted, else a paginated envelope
   */
  async findOptions(
    tenantId: string,
    branchId: string,
    filters: {
      search?: string;
      page?: number;
      limit?: number;
      listId?: string;
    } = {},
  ): Promise<
    Array<BranchLabTestOption> | PaginatedResult<BranchLabTestOption>
  > {
    const where: Prisma.BranchLabTestWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
      isActive: true,
      isDefault: true,
      // Scope to the resolved pricing list (Create-Order) — omitted = Walk-in.
      listId: filters.listId ?? (await this.resolveListId(tenantId, branchId)),
    };
    const term = filters.search?.trim();
    if (term) {
      where.testName = { contains: term, mode: 'insensitive' };
    }

    const select = {
      id: true,
      testName: true,
      listPrice: true,
      configSnapshot: true,
    } as const;
    const orderBy = { testName: 'asc' } as const;
    const toOption = (r: {
      id: string;
      testName: string;
      listPrice: number;
      configSnapshot: Prisma.JsonValue;
    }): BranchLabTestOption => {
      const sample = (
        r.configSnapshot as unknown as BranchLabTestConfigSnapshot
      )?.samples?.[0];
      return {
        id: r.id,
        name: r.testName,
        price: r.listPrice,
        sampleType: sample?.sampleType ?? null,
        isFasting: sample?.isFastingRequired ?? false,
      };
    };

    if (filters.page === undefined) {
      const rows = await this.prisma.branchLabTest.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map(toOption);
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.branchLabTest.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.branchLabTest.count({ where }),
    ]);
    return { data: rows.map(toOption), total, page, limit };
  }

  /**
   * Fetch one branch lab test (with its `configSnapshot`) scoped to tenant+branch.
   * @throws BranchLabTestNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabTest> {
    const row = await this.prisma.branchLabTest.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!row) {
      throw new BranchLabTestNotFoundException(id);
    }
    return row;
  }

  /**
   * Edit a branch lab test's branch-tunable fields (pricing, flags, TAT, notes,
   * display, active). Identity/classification/clinical snapshot are not editable
   * here (managed via re-import/sync). Validates price ordering before writing.
   * @throws BranchLabTestNotFoundException if missing
   * @throws ValidationException if the merged prices violate min ≤ max ≤ msrp
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: UpdateBranchLabTestDto,
  ): Promise<BranchLabTest> {
    const current = await this.findById(id, tenantId, branchId);
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? current.priceMsrp,
      priceMaximum: dto.priceMaximum ?? current.priceMaximum,
      priceMinimum: dto.priceMinimum ?? current.priceMinimum,
    });
    return this.prisma.branchLabTest.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
    });
  }

  /**
   * Bulk-edit branch lab tests: apply per-row branch-tunable changes to the
   * selected ids (all scoped to the caller's tenant + active branch). All
   * existence/invariant checks run before the transaction opens, so if any item
   * is invalid or its `id` can't be resolved, nothing changes.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto the array of per-row edits
   * @returns the number of branch lab tests updated
   * @throws ValidationException on duplicate ids, an empty item, or a broken price ordering
   * @throws BranchLabTestNotFoundException if an `id` doesn't resolve to an active row
   */
  async bulkUpdate(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: BulkEditBranchLabTestsDto,
  ): Promise<BranchLabTestBulkEditResult> {
    const items = dto.data;
    const ids = items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationException('Duplicate id in payload');
    }

    const edits = items.map((item) => {
      const { id, ...changes } = item;
      const data = this.pickDefined(changes);
      if (Object.keys(data).length === 0) {
        throw new ValidationException(`No changes provided for row ${id}`);
      }
      return { id, changes, data };
    });

    const rows = await this.prisma.branchLabTest.findMany({
      where: { id: { in: ids }, tenantId, branchId, deletedAt: null },
    });
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const missing = ids.find((id) => !rowById.has(id));
    if (missing) {
      throw new BranchLabTestNotFoundException(missing);
    }

    for (const { id, changes } of edits) {
      const row = rowById.get(id)!;
      this.assertPriceOrdering({
        priceMsrp: changes.priceMsrp ?? row.priceMsrp,
        priceMaximum: changes.priceMaximum ?? row.priceMaximum,
        priceMinimum: changes.priceMinimum ?? row.priceMinimum,
      });
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      for (const { id, data } of edits) {
        await tx.branchLabTest.update({
          where: { id },
          data: { ...data, updatedBy: actorId },
        });
      }
    });
    return { updated: edits.length };
  }

  /**
   * Enable/disable a branch lab test in the branch's Lab Test List.
   * @throws BranchLabTestNotFoundException if missing
   */
  async setActive(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    isActive: boolean,
  ): Promise<BranchLabTest> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.branchLabTest.update({
      where: { id },
      data: { isActive, updatedBy: actorId },
    });
  }

  /**
   * Duplicate a branch lab test into an independent, editable variant in the same
   * group (same `sourceLabTestId`). The copy starts as a non-default duplicate
   * (`isDuplicate=true`, `isDefault=false`) so it is untouched by sync; its
   * display name is suffixed " (Copy)". All scalar fields + `configSnapshot` are
   * copied. Single write → per-op RLS.
   * @throws BranchLabTestNotFoundException if the source row is missing
   */
  async duplicate(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchLabTest> {
    const row = await this.findById(id, tenantId, branchId);
    return this.prisma.branchLabTest.create({
      data: this.buildDuplicateData(row, actorId),
    });
  }

  /**
   * Mark a branch lab test as the default of its variant group (used for order
   * creation). Clears `isDefault` on the group's other active rows first, then
   * sets this one — one transaction so the one-default-per-group index holds.
   * @throws BranchLabTestNotFoundException if missing
   */
  async setDefault(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchLabTest> {
    const row = await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (row.sourceLabTestId) {
        await tx.branchLabTest.updateMany({
          where: {
            tenantId,
            branchId,
            sourceLabTestId: row.sourceLabTestId,
            deletedAt: null,
            isDefault: true,
            id: { not: id },
          },
          data: { isDefault: false },
        });
      }
      return tx.branchLabTest.update({
        where: { id },
        data: { isDefault: true, updatedBy: actorId },
      });
    });
  }

  /**
   * Soft-delete a branch lab test (removes it from the branch's Lab Test List). If
   * it was the group's default and active siblings remain, one is promoted to
   * default so the group keeps an orderable row.
   * @throws BranchLabTestNotFoundException if missing
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabTest> {
    const row = await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await tx.branchLabTest.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      if (row.isDefault && row.sourceLabTestId) {
        const sibling = await tx.branchLabTest.findFirst({
          where: {
            tenantId,
            branchId,
            sourceLabTestId: row.sourceLabTestId,
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (sibling) {
          await tx.branchLabTest.update({
            where: { id: sibling.id },
            data: { isDefault: true },
          });
        }
      }
      return deleted;
    });
  }

  /**
   * Build the create payload for a branch lab test from a composed Master Data
   * test. Copies all parent scalars, folds the children into `configSnapshot`,
   * and stamps the branch scope + provenance. Public so the branch-lab-panel
   * import can materialize member-test copies with identical semantics.
   * @param source the composed source lab test (with children)
   * @param target branch scope + source master data + actor
   */
  buildImportData(
    source: LabTestWithChildren,
    target: ImportTarget,
  ): Prisma.BranchLabTestUncheckedCreateInput {
    const { scalars, configSnapshot } = this.extractScalars(source);
    return {
      ...scalars,
      tenantId: target.tenantId,
      branchId: target.branchId,
      sourceLabTestId: source.id,
      sourceMasterDataId: target.sourceMasterDataId,
      listId: target.listId,
      // Walk-in default list: the sellable list price starts at MSRP.
      listPrice: (scalars.priceMsrp as number) ?? 0,
      configSnapshot,
      createdBy: target.actorId,
      updatedBy: target.actorId,
    } as Prisma.BranchLabTestUncheckedCreateInput;
  }

  /**
   * Build the create payload for a duplicate from an existing branch row: copy
   * all fields except the re-derived ones, keep the same variant group
   * (`sourceLabTestId`), and mark it a non-default duplicate with a " (Copy)"
   * display name.
   */
  private buildDuplicateData(
    row: BranchLabTest,
    actorId: string | null,
  ): Prisma.BranchLabTestUncheckedCreateInput {
    const copy: Record<string, unknown> = { ...row };
    for (const key of ['id', 'createdAt', 'updatedAt', 'deletedAt']) {
      delete copy[key];
    }
    return {
      ...copy,
      isDefault: false,
      isDuplicate: true,
      testDisplayName: `${row.testDisplayName ?? row.testName} (Copy)`,
      createdBy: actorId,
      updatedBy: actorId,
    } as Prisma.BranchLabTestUncheckedCreateInput;
  }

  /** Build the overwrite (re-snapshot) update payload from a composed source test. */
  private buildSyncData(
    source: LabTestWithChildren,
    actorId: string | null,
  ): Prisma.BranchLabTestUncheckedUpdateInput {
    const { scalars, configSnapshot } = this.extractScalars(source);
    return {
      ...scalars,
      // Walk-in list price tracks MSRP on re-snapshot (agreed overwrite contract).
      listPrice: (scalars.priceMsrp as number) ?? 0,
      configSnapshot,
      updatedBy: actorId,
    };
  }

  /**
   * Resolve the branch's default (Walk-in) list id for an unscoped read. Returns a
   * non-matching sentinel when the branch has never imported (so reads are empty
   * rather than mixing lists). Does not create the list (reads must not write).
   */
  private async resolveListId(
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const list = await this.prisma.branchLabTestList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    return list?.id ?? '__no_list__';
  }

  /**
   * Split a composed source test into its copyable parent scalars and a JSON
   * clinical snapshot. Drops re-derived/scope keys (id, scope, source, versioning,
   * timestamps) and the child arrays (folded into the snapshot instead).
   */
  private extractScalars(source: LabTestWithChildren): {
    scalars: Record<string, unknown>;
    configSnapshot: Prisma.InputJsonValue;
  } {
    const copy: Record<string, unknown> = { ...source };
    const configSnapshot = {
      samples: copy.samples,
      resultParams: copy.resultParams,
    } as unknown as Prisma.InputJsonValue;
    for (const key of BRANCH_TEST_DROP_KEYS) {
      delete copy[key];
    }
    return { scalars: copy, configSnapshot };
  }

  /** Enforce price ordering (min ≤ max ≤ msrp) ahead of the DB CHECK constraints. */
  private assertPriceOrdering(prices: {
    priceMsrp: number;
    priceMaximum: number;
    priceMinimum: number;
  }): void {
    if (prices.priceMaximum > prices.priceMsrp) {
      throw new ValidationException(
        'priceMaximum must be less than or equal to priceMsrp',
      );
    }
    if (prices.priceMinimum > prices.priceMaximum) {
      throw new ValidationException(
        'priceMinimum must be less than or equal to priceMaximum',
      );
    }
  }

  /** Strip undefined keys from one bulk-edit item's changes, yielding a Prisma update. */
  private pickDefined(
    changes: Omit<BulkEditBranchLabTestsDto['data'][number], 'id'>,
  ): Prisma.BranchLabTestUncheckedUpdateInput {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }

  /** Translate the one-default-per-group unique violation into a typed 409. */
  private rethrowConflict(e: unknown): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new BranchLabTestDefaultConflictException();
    }
  }
}
