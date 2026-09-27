import { Injectable } from '@nestjs/common';
import {
  BranchRadiologyTest,
  DayOfWeek,
  Prisma,
  TatUnit,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { RadiologyMasterDataService } from '../radiology-master-data/radiology-master-data.service';
import { RadiologyTestService } from '../radiology-test/radiology-test.service';
import { BranchRadiologyTestListService } from '../branch-radiology-test-list/branch-radiology-test-list.service';
import { RadiologyTestWithChildren } from '../radiology-test/entities/radiology-test.entity';
import { RadiologyTestNotFoundException } from '../radiology-test/exceptions/radiology-test.exceptions';
import { ImportBranchRadiologyTestsDto } from './dto/import-branch-radiology-tests.dto';
import { SyncBranchRadiologyTestsDto } from './dto/sync-branch-radiology-tests.dto';
import { ListBranchRadiologyTestsQueryDto } from './dto/list-branch-radiology-tests-query.dto';
import { UpdateBranchRadiologyTestDto } from './dto/update-branch-radiology-test.dto';
import { BulkEditBranchRadiologyTestsDto } from './dto/bulk-edit-branch-radiology-tests.dto';
import {
  BranchRadiologyTestDefaultConflictException,
  BranchRadiologyTestNotFoundException,
} from './exceptions/branch-radiology-test.exceptions';
import {
  BranchRadiologyTestConfigSnapshot,
  BranchRadiologyTestImportResult,
  BranchRadiologyTestListRow,
  BranchRadiologyTestSyncResult,
} from './entities/branch-radiology-test.entity';

/** Result of a bulk-edit: the number of branch radiology tests updated. */
export interface BranchRadiologyTestBulkEditResult {
  updated: number;
}

/** A Create-Order radiology-test option row. */
export interface BranchRadiologyTestOption {
  id: string;
  name: string;
  price: number;
  sampleType: string | null;
  isFasting: boolean;
  scheduleDays: DayOfWeek[];
  scheduleFrom: string | null;
  scheduleTo: string | null;
  tatMinValue: number | null;
  tatMinUnit: TatUnit | null;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
}

/** The scope/actor a source Master Data test is materialized into. */
interface ImportTarget {
  tenantId: string;
  branchId: string;
  sourceMasterDataId: string;
  listId: string;
  actorId: string | null;
}

/**
 * Source keys that are re-derived (never copied) or folded into `configSnapshot`
 * when materializing a branch radiology test from a composed Master Data test.
 */
const BRANCH_TEST_DROP_KEYS = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'source',
  'clonedFromId',
  'templateSyncedAt',
  'sourceMasterLabTestId',
  'versionHistory',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'samples',
  'resultParams',
  // `RadiologyTest.approvalWorkflow` is an enum with no BranchRadiologyTest
  // counterpart (the branch model has `approvalWorkflowId`, a different concept).
  'approvalWorkflow',
  // RadiologyTest-only flags with no BranchRadiologyTest counterpart.
  'isOutsource',
  'isBillOnlyTest',
  'isSampleFlow',
  'isOverrideAllowed',
];

/**
 * A branch's operational **Radiology Test List** — materialized, independent
 * snapshots copied from the branch's Master Data radiology tests. Tenant-scoped +
 * branch-level; tenant/branch come from the JWT (never the body). Import copies
 * selected Master Data tests (deep clinical config folded into `configSnapshot`);
 * sync overwrites copies from their source; edits here never propagate back.
 * Prisma-direct; multi-row writes run in `withTenant` transactions.
 */
@Injectable()
export class BranchRadiologyTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: RadiologyMasterDataService,
    private readonly radiologyTestService: RadiologyTestService,
    private readonly listService: BranchRadiologyTestListService,
  ) {}

  /**
   * Persist-import the selected Master Data radiology tests into the active branch's
   * Radiology Test List. Idempotent: a source already in the target list (matched by
   * `sourceLabTestId`) is re-snapshotted; a new one is materialized. Copies run in one
   * transaction.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the source test ids to import, plus an optional target `listId`
   * @returns counts of copied vs updated vs skipped tests
   */
  async importFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: ImportBranchRadiologyTestsDto,
  ): Promise<BranchRadiologyTestImportResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    const targetList = await this.resolveTargetList(
      tenantId,
      branchId,
      actorId,
      dto.listId,
    );
    const plan = await this.buildImportPlan(
      masterData.id,
      tenantId,
      branchId,
      targetList.id,
      actorId,
      dto.labTestIds,
    );
    await this.writeImportPlan(tenantId, plan.toCreate, plan.toUpdate);
    return {
      copied: plan.toCreate.length,
      updated: plan.toUpdate.length,
      skipped: plan.skipped,
    };
  }

  /**
   * Import every Master Data radiology test matching the given search/classification
   * filters (server-resolved) into the active branch's list ("select all"). Mirrors
   * {@link importFromMasterData}'s semantics; writes commit in fixed-size batches.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the search/classification filters plus an optional target `listId`
   * @returns counts of copied vs updated tests
   */
  async importFromMasterDataByFilter(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: {
      search?: string;
      department?: string;
      category?: string;
      subCategory?: string;
      listId?: string;
    },
  ): Promise<BranchRadiologyTestImportResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    const targetList = await this.resolveTargetList(
      tenantId,
      branchId,
      actorId,
      dto.listId,
    );
    const where = await this.masterDataService.buildImportableTestWhere(
      masterData.id,
      tenantId,
      dto.search,
      {
        department: dto.department,
        category: dto.category,
        subCategory: dto.subCategory,
      },
      targetList.id,
    );
    const matches = await this.prisma.radiologyTest.findMany({
      where,
      select: { id: true },
    });
    const ids = matches.map((m) => m.id);

    let copied = 0;
    let updated = 0;
    const WRITE_BATCH_SIZE = 25;
    for (let i = 0; i < ids.length; i += WRITE_BATCH_SIZE) {
      const batchIds = ids.slice(i, i + WRITE_BATCH_SIZE);
      const plan = await this.buildImportPlan(
        masterData.id,
        tenantId,
        branchId,
        targetList.id,
        actorId,
        batchIds,
      );
      await this.writeImportPlan(tenantId, plan.toCreate, plan.toUpdate);
      copied += plan.toCreate.length;
      updated += plan.toUpdate.length;
    }
    return { copied, updated, skipped: 0 };
  }

  /**
   * Resolve the list an import/sync should target: the default (Walk-in) list is
   * always ensured to exist first, then the given `listId` is used if present
   * (validated to belong to this branch) or the default list otherwise.
   */
  private async resolveTargetList(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    listId?: string,
  ) {
    const defaultList = await this.listService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    return listId
      ? await this.listService.findById(listId, tenantId, branchId)
      : defaultList;
  }

  /**
   * Resolve a set of Master Data test ids into create/update payloads for the target
   * list: a source already copied into it (matched by `sourceLabTestId`) is
   * re-snapshotted (UPDATE); a new one is materialized (CREATE).
   */
  private async buildImportPlan(
    masterDataId: string,
    tenantId: string,
    branchId: string,
    targetListId: string,
    actorId: string | null,
    candidateIds: string[],
  ): Promise<{
    toCreate: Prisma.BranchRadiologyTestUncheckedCreateInput[];
    toUpdate: {
      id: string;
      data: Prisma.BranchRadiologyTestUncheckedUpdateInput;
    }[];
    skipped: number;
  }> {
    const validSources = await this.prisma.radiologyTest.findMany({
      where: {
        id: { in: candidateIds },
        masterDataId,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const validIds = validSources.map((s) => s.id);
    const existing = await this.prisma.branchRadiologyTest.findMany({
      where: {
        tenantId,
        branchId,
        listId: targetListId,
        deletedAt: null,
        sourceLabTestId: { in: validIds },
      },
      select: { id: true, sourceLabTestId: true },
    });
    const existingBySource = new Map(
      existing.map((t) => [t.sourceLabTestId, t.id] as const),
    );

    const toCreate: Prisma.BranchRadiologyTestUncheckedCreateInput[] = [];
    const toUpdate: {
      id: string;
      data: Prisma.BranchRadiologyTestUncheckedUpdateInput;
    }[] = [];
    const skipped = candidateIds.length - validIds.length;
    for (const id of validIds) {
      const source = await this.radiologyTestService.findById(
        masterDataId,
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
            sourceMasterDataId: masterDataId,
            listId: targetListId,
            actorId,
          }),
        );
      }
    }
    return { toCreate, toUpdate, skipped };
  }

  /** Apply a resolved create/update plan in one transaction. */
  private async writeImportPlan(
    tenantId: string,
    toCreate: Prisma.BranchRadiologyTestUncheckedCreateInput[],
    toUpdate: {
      id: string;
      data: Prisma.BranchRadiologyTestUncheckedUpdateInput;
    }[],
  ): Promise<void> {
    if (!toCreate.length && !toUpdate.length) return;
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        for (const data of toCreate) {
          await tx.branchRadiologyTest.create({ data });
        }
        for (const u of toUpdate) {
          await tx.branchRadiologyTest.update({
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

  /**
   * Re-snapshot branch radiology tests from their source Master Data tests. Reloads
   * each copy's source (via `sourceLabTestId`) and OVERWRITES the copy's parent fields
   * and clinical snapshot. Copies whose source is missing/soft-deleted are removed.
   * Runs in batched transactions.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto optional subset of branch-test ids to sync + optional target `listId`
   * @returns counts of synced vs deleted vs skipped copies
   */
  async syncFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: SyncBranchRadiologyTestsDto,
  ): Promise<BranchRadiologyTestSyncResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    const defaultList = await this.listService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const targetList = dto.listId
      ? await this.listService.findById(dto.listId, tenantId, branchId)
      : defaultList;
    const where: Prisma.BranchRadiologyTestWhereInput = {
      tenantId,
      branchId,
      listId: targetList.id,
      deletedAt: null,
      isDuplicate: false,
      sourceLabTestId: { not: null },
    };
    if (dto.branchLabTestIds?.length) {
      where.id = { in: dto.branchLabTestIds };
    }
    const copies = await this.prisma.branchRadiologyTest.findMany({
      where,
      select: { id: true, sourceLabTestId: true, isDefault: true },
    });

    const updates: {
      id: string;
      data: Prisma.BranchRadiologyTestUncheckedUpdateInput;
    }[] = [];
    const toDelete: {
      id: string;
      isDefault: boolean;
      sourceLabTestId: string | null;
    }[] = [];
    let skipped = 0;
    const resolvable = copies.filter((copy) => {
      if (!copy.sourceLabTestId) {
        skipped += 1;
        return false;
      }
      return true;
    });
    const RESOLVE_CHUNK_SIZE = 25;
    for (let i = 0; i < resolvable.length; i += RESOLVE_CHUNK_SIZE) {
      const chunk = resolvable.slice(i, i + RESOLVE_CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map(async (copy) => {
          try {
            const source = await this.radiologyTestService.findById(
              masterData.id,
              copy.sourceLabTestId!,
              tenantId,
            );
            return { copy, source };
          } catch (e) {
            if (e instanceof RadiologyTestNotFoundException) {
              return { copy, source: null };
            }
            throw e;
          }
        }),
      );
      for (const { copy, source } of results) {
        if (source) {
          updates.push({
            id: copy.id,
            data: this.buildSyncData(source, actorId),
          });
        } else {
          toDelete.push(copy);
        }
      }
    }

    const SYNC_BATCH_SIZE = 25;
    for (let i = 0; i < updates.length; i += SYNC_BATCH_SIZE) {
      const batch = updates.slice(i, i + SYNC_BATCH_SIZE);
      if (batch.length === 0) continue;
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          for (const u of batch) {
            await tx.branchRadiologyTest.update({
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
    for (let i = 0; i < toDelete.length; i += SYNC_BATCH_SIZE) {
      const batch = toDelete.slice(i, i + SYNC_BATCH_SIZE);
      if (batch.length === 0) continue;
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          for (const d of batch) {
            await tx.branchRadiologyTest.update({
              where: { id: d.id },
              data: { deletedAt: new Date() },
            });
            if (d.isDefault && d.sourceLabTestId) {
              const sibling = await tx.branchRadiologyTest.findFirst({
                where: {
                  tenantId,
                  branchId,
                  sourceLabTestId: d.sourceLabTestId,
                  deletedAt: null,
                },
                orderBy: { createdAt: 'asc' },
              });
              if (sibling) {
                await tx.branchRadiologyTest.update({
                  where: { id: sibling.id },
                  data: { isDefault: true },
                });
              }
            }
          }
        });
      } catch (e) {
        this.rethrowConflict(e);
        throw e;
      }
    }
    return { synced: updates.length, deleted: toDelete.length, skipped };
  }

  /**
   * List the branch's Radiology Test List (paginated). Supports a case-insensitive
   * `search` on testName/testCode and an active `status` filter.
   * @param tenantId tenant scope
   * @param branchId active branch
   * @param query pagination + filters
   */
  async findAll(
    tenantId: string,
    branchId: string,
    query: ListBranchRadiologyTestsQueryDto,
  ): Promise<PaginatedResult<BranchRadiologyTestListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.BranchRadiologyTestWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
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
      this.prisma.branchRadiologyTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { testName: 'asc' },
      }),
      this.prisma.branchRadiologyTest.count({ where }),
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
    const enriched: BranchRadiologyTestListRow[] = data.map((t) => ({
      ...t,
      departmentName: this.nameOf(deptNames, t.departmentId),
      categoryName: this.nameOf(catNames, t.categoryId),
      subCategoryName: this.nameOf(subCatNames, t.subCategoryId),
      sampleSummary:
        (
          t.configSnapshot as unknown as BranchRadiologyTestConfigSnapshot
        )?.samples
          ?.map((s) => s.sampleType)
          .filter(Boolean)
          .join(', ') || null,
    }));
    return { data: enriched, total, page, limit };
  }

  /**
   * Resolve a set of classification ids to a `id → name` map (tenant-scoped).
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
   * Lightweight `{ id, name, price, sampleType, isFasting, … }` options for the
   * Create-Order radiology-test selector — the branch's active default-variant rows
   * only. Supports a case-insensitive `search` on testName; `preferredOnly` narrows
   * to `isPreferenceTest` when set AND no `search` term is given.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param filters optional search + offset pagination + list + preferred
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
      preferredOnly?: boolean;
    } = {},
  ): Promise<
    | Array<BranchRadiologyTestOption>
    | PaginatedResult<BranchRadiologyTestOption>
  > {
    const where: Prisma.BranchRadiologyTestWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
      isActive: true,
      isDefault: true,
      listId: filters.listId ?? (await this.resolveListId(tenantId, branchId)),
    };
    const term = filters.search?.trim();
    if (term) {
      where.testName = { contains: term, mode: 'insensitive' };
    } else if (filters.preferredOnly) {
      where.isPreferenceTest = true;
    }

    const select = {
      id: true,
      testName: true,
      listPrice: true,
      configSnapshot: true,
      scheduleDays: true,
      scheduleFrom: true,
      scheduleTo: true,
      tatMinValue: true,
      tatMinUnit: true,
      tatMaxValue: true,
      tatMaxUnit: true,
    } as const;
    const orderBy = { testName: 'asc' } as const;
    const toOption = (r: {
      id: string;
      testName: string;
      listPrice: number;
      configSnapshot: Prisma.JsonValue;
      scheduleDays: DayOfWeek[];
      scheduleFrom: string | null;
      scheduleTo: string | null;
      tatMinValue: number | null;
      tatMinUnit: TatUnit | null;
      tatMaxValue: number | null;
      tatMaxUnit: TatUnit | null;
    }): BranchRadiologyTestOption => {
      const sample = (
        r.configSnapshot as unknown as BranchRadiologyTestConfigSnapshot
      )?.samples?.[0];
      return {
        id: r.id,
        name: r.testName,
        price: r.listPrice,
        sampleType: sample?.sampleType ?? null,
        isFasting: sample?.isFastingRequired ?? false,
        scheduleDays: r.scheduleDays,
        scheduleFrom: r.scheduleFrom,
        scheduleTo: r.scheduleTo,
        tatMinValue: r.tatMinValue,
        tatMinUnit: r.tatMinUnit,
        tatMaxValue: r.tatMaxValue,
        tatMaxUnit: r.tatMaxUnit,
      };
    };

    if (filters.page === undefined) {
      const rows = await this.prisma.branchRadiologyTest.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map(toOption);
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.branchRadiologyTest.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.branchRadiologyTest.count({ where }),
    ]);
    return { data: rows.map(toOption), total, page, limit };
  }

  /**
   * Fetch one branch radiology test (with its `configSnapshot`) scoped to
   * tenant+branch.
   * @throws BranchRadiologyTestNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyTest> {
    const row = await this.prisma.branchRadiologyTest.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!row) {
      throw new BranchRadiologyTestNotFoundException(id);
    }
    return row;
  }

  /**
   * Edit a branch radiology test's branch-tunable fields. Validates price ordering
   * before writing.
   * @throws BranchRadiologyTestNotFoundException if missing
   * @throws ValidationException if the merged prices violate min ≤ max ≤ msrp
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: UpdateBranchRadiologyTestDto,
  ): Promise<BranchRadiologyTest> {
    const current = await this.findById(id, tenantId, branchId);
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? current.priceMsrp,
      priceMaximum: dto.priceMaximum ?? current.priceMaximum,
      priceMinimum: dto.priceMinimum ?? current.priceMinimum,
    });
    return this.prisma.branchRadiologyTest.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
    });
  }

  /**
   * Bulk-edit branch radiology tests: apply per-row branch-tunable changes to the
   * selected ids. All checks run before the transaction opens.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto the array of per-row edits
   * @returns the number of branch radiology tests updated
   */
  async bulkUpdate(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: BulkEditBranchRadiologyTestsDto,
  ): Promise<BranchRadiologyTestBulkEditResult> {
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

    const rows = await this.prisma.branchRadiologyTest.findMany({
      where: { id: { in: ids }, tenantId, branchId, deletedAt: null },
    });
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const missing = ids.find((id) => !rowById.has(id));
    if (missing) {
      throw new BranchRadiologyTestNotFoundException(missing);
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
        await tx.branchRadiologyTest.update({
          where: { id },
          data: { ...data, updatedBy: actorId },
        });
      }
    });
    return { updated: edits.length };
  }

  /**
   * Enable/disable a branch radiology test in the branch's Radiology Test List.
   * @throws BranchRadiologyTestNotFoundException if missing
   */
  async setActive(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    isActive: boolean,
  ): Promise<BranchRadiologyTest> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.branchRadiologyTest.update({
      where: { id },
      data: { isActive, updatedBy: actorId },
    });
  }

  /**
   * Duplicate a branch radiology test into an independent, editable variant in the
   * same group (same `sourceLabTestId`). The copy starts as a non-default duplicate.
   * @throws BranchRadiologyTestNotFoundException if the source row is missing
   */
  async duplicate(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchRadiologyTest> {
    const row = await this.findById(id, tenantId, branchId);
    return this.prisma.branchRadiologyTest.create({
      data: this.buildDuplicateData(row, actorId),
    });
  }

  /**
   * Mark a branch radiology test as the default of its variant group. Clears
   * `isDefault` on the group's other active rows first, then sets this one — one
   * transaction so the one-default-per-group index holds.
   * @throws BranchRadiologyTestNotFoundException if missing
   */
  async setDefault(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchRadiologyTest> {
    const row = await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (row.sourceLabTestId) {
        await tx.branchRadiologyTest.updateMany({
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
      return tx.branchRadiologyTest.update({
        where: { id },
        data: { isDefault: true, updatedBy: actorId },
      });
    });
  }

  /**
   * Soft-delete a branch radiology test. If it was the group's default and active
   * siblings remain, one is promoted to default.
   * @throws BranchRadiologyTestNotFoundException if missing
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyTest> {
    const row = await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted = await tx.branchRadiologyTest.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      if (row.isDefault && row.sourceLabTestId) {
        const sibling = await tx.branchRadiologyTest.findFirst({
          where: {
            tenantId,
            branchId,
            sourceLabTestId: row.sourceLabTestId,
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (sibling) {
          await tx.branchRadiologyTest.update({
            where: { id: sibling.id },
            data: { isDefault: true },
          });
        }
      }
      return deleted;
    });
  }

  /**
   * Build the create payload for a branch radiology test from a composed Master Data
   * test. Public so the branch-radiology-panel import can materialize member-test
   * copies with identical semantics.
   * @param source the composed source radiology test (with children)
   * @param target branch scope + source master data + actor
   */
  buildImportData(
    source: RadiologyTestWithChildren,
    target: ImportTarget,
  ): Prisma.BranchRadiologyTestUncheckedCreateInput {
    const { scalars, configSnapshot } = this.extractScalars(source);
    return {
      ...scalars,
      tenantId: target.tenantId,
      branchId: target.branchId,
      sourceLabTestId: source.id,
      sourceMasterDataId: target.sourceMasterDataId,
      listId: target.listId,
      listPrice: (scalars.priceMsrp as number) ?? 0,
      configSnapshot,
      createdBy: target.actorId,
      updatedBy: target.actorId,
    } as Prisma.BranchRadiologyTestUncheckedCreateInput;
  }

  /**
   * Build the create payload for a duplicate from an existing branch row.
   */
  private buildDuplicateData(
    row: BranchRadiologyTest,
    actorId: string | null,
  ): Prisma.BranchRadiologyTestUncheckedCreateInput {
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
    } as Prisma.BranchRadiologyTestUncheckedCreateInput;
  }

  /** Build the overwrite (re-snapshot) update payload from a composed source test. */
  private buildSyncData(
    source: RadiologyTestWithChildren,
    actorId: string | null,
  ): Prisma.BranchRadiologyTestUncheckedUpdateInput {
    const { scalars, configSnapshot } = this.extractScalars(source);
    return {
      ...scalars,
      listPrice: (scalars.priceMsrp as number) ?? 0,
      configSnapshot,
      updatedBy: actorId,
    };
  }

  /**
   * Resolve the branch's default (Walk-in) list id for an unscoped read. Returns a
   * non-matching sentinel when the branch has never imported. Does not create the list.
   */
  private async resolveListId(
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const list = await this.prisma.branchRadiologyTestList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    return list?.id ?? '__no_list__';
  }

  /**
   * Split a composed source test into its copyable parent scalars and a JSON
   * clinical snapshot. Drops re-derived/scope keys and the child arrays. Whitelists
   * to columns that exist on BranchRadiologyTest so master-only columns can't break
   * the create/update.
   */
  private extractScalars(source: RadiologyTestWithChildren): {
    scalars: Record<string, unknown>;
    configSnapshot: Prisma.InputJsonValue;
  } {
    const configSnapshot = {
      samples: (source as Record<string, unknown>).samples,
      resultParams: (source as Record<string, unknown>).resultParams,
    } as unknown as Prisma.InputJsonValue;
    const validFields = new Set<string>(
      Object.keys(Prisma.BranchRadiologyTestScalarFieldEnum),
    );
    const dropKeys = new Set<string>(BRANCH_TEST_DROP_KEYS);
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (validFields.has(key) && !dropKeys.has(key)) copy[key] = value;
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
    changes: Omit<BulkEditBranchRadiologyTestsDto['data'][number], 'id'>,
  ): Prisma.BranchRadiologyTestUncheckedUpdateInput {
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
      throw new BranchRadiologyTestDefaultConflictException();
    }
  }
}
