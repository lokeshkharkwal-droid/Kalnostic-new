import { Injectable } from '@nestjs/common';
import {
  BranchRadiologyTest,
  DayOfWeek,
  Prisma,
  RadiologyModality,
  RadiologyTest,
  TatUnit,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { BranchRadiologyTestListService } from '../branch-radiology-test-list/branch-radiology-test-list.service';
import { ImportBranchRadiologyTestsDto } from './dto/import-branch-radiology-tests.dto';
import { SyncBranchRadiologyTestsDto } from './dto/sync-branch-radiology-tests.dto';
import { ListBranchRadiologyTestsQueryDto } from './dto/list-branch-radiology-tests-query.dto';
import { UpdateBranchRadiologyTestDto } from './dto/update-branch-radiology-test.dto';
import {
  BranchRadiologyTestDefaultConflictException,
  BranchRadiologyTestNotFoundException,
} from './exceptions/branch-radiology-test.exceptions';
import {
  BranchRadiologyTestImportResult,
  BranchRadiologyTestListRow,
  BranchRadiologyTestSyncResult,
} from './entities/branch-radiology-test.entity';

/** A Create-Order radiology-test option row (Diagnostic Items table). */
export interface BranchRadiologyTestOption {
  id: string;
  name: string;
  price: number;
  modality: RadiologyModality;
  bodyPart: string | null;
  view: string | null;
  isContrast: boolean;
  /** Whether discounts may be applied to this test (drives the FE discount input). */
  isAllowDiscounts: boolean;
  /** Billed-only test: excluded from the imaging workflow. */
  isBillOnlyTest: boolean;
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
  /** The pricing list the copy belongs to (each list owns its rows). */
  listId: string;
  actorId: string | null;
}

/**
 * A branch's operational **Radiology Test List** — materialized, independent
 * snapshots copied from the branch's Master Data radiology tests. Tenant-scoped +
 * branch-level; tenant/branch come from the JWT (never the body). The radiology
 * model is FLAT, so there are no clinical children to snapshot (`configSnapshot`
 * stays `{}`); import copies the source test's scalar fields verbatim. Sync
 * overwrites copies from their source; edits here never propagate back to Master
 * Data. Prisma-direct; multi-row writes run in `withTenant` transactions. Mirrors
 * `BranchLabTestService` for the flat model (bulk-edit is intentionally dropped).
 */
@Injectable()
export class BranchRadiologyTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: MasterDataService,
    private readonly listService: BranchRadiologyTestListService,
  ) {}

  /**
   * Persist-import the selected Master Data radiology tests into the active
   * branch's Radiology Test List. Each source (of the branch's 1:1 master data)
   * is copied as the group's imported original (`isDefault=true`,
   * `isDuplicate=false`) with a fresh id. Idempotent: a source whose variant
   * group already has an active row (matched by `sourceRadiologyTestId`) is
   * updated (re-snapshotted), not duplicated; ids not in the branch's master data
   * are skipped. Writes run in one transaction.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the source radiology-test ids to import, plus an optional target `listId`
   * @returns counts of copied vs updated vs skipped tests
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   * @throws BranchRadiologyTestListNotFoundException if `dto.listId` doesn't belong to this branch
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
      dto.radiologyTestIds,
    );
    await this.writeImportPlan(tenantId, plan.toCreate, plan.toUpdate);
    return {
      copied: plan.toCreate.length,
      updated: plan.toUpdate.length,
      skipped: plan.skipped,
    };
  }

  /**
   * Import every Master Data radiology test matching the given search/
   * classification filters (server-resolved — no client-supplied id list) into
   * the active branch's Radiology Test List. Mirrors
   * {@link importFromMasterData}'s create/update semantics; writes commit in
   * fixed-size batches so a "select all" can't become a single all-or-nothing
   * write.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the search/classification filters plus an optional target `listId`
   * @returns counts of copied vs updated tests (no "skipped")
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   * @throws BranchRadiologyTestListNotFoundException if `dto.listId` doesn't belong to this branch
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
    const where = await this.buildImportableWhere(
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
   * Build the `where` for the importable Master Data radiology tests — matching
   * the import-picker's "Available to Add" listing. Excludes sources already
   * copied into the target list (by `sourceRadiologyTestId`).
   */
  private async buildImportableWhere(
    masterDataId: string,
    tenantId: string,
    search: string | undefined,
    classificationFilters: {
      department?: string;
      category?: string;
      subCategory?: string;
    },
    excludeListId?: string,
  ): Promise<Prisma.RadiologyTestWhereInput> {
    const where: Prisma.RadiologyTestWhereInput = {
      masterDataId,
      tenantId,
      deletedAt: null,
    };
    if (excludeListId) {
      const existing = await this.prisma.branchRadiologyTest.findMany({
        where: {
          tenantId,
          listId: excludeListId,
          deletedAt: null,
          sourceRadiologyTestId: { not: null },
        },
        select: { sourceRadiologyTestId: true },
      });
      const existingIds = existing
        .map((r) => r.sourceRadiologyTestId)
        .filter((x): x is string => Boolean(x));
      if (existingIds.length > 0) {
        where.id = { notIn: existingIds };
      }
    }
    const term = search?.trim();
    if (term) {
      where.OR = [
        { testName: { contains: term, mode: 'insensitive' } },
        { testCode: { contains: term, mode: 'insensitive' } },
      ];
    }
    // Classification refs on RadiologyTest are logical (no Prisma relation), so
    // these name filters resolve the matching catalogue ids first.
    const dept = classificationFilters.department?.trim();
    if (dept) {
      where.departmentId = {
        in: await this.classificationIdsByName('department', tenantId, dept),
      };
    }
    const cat = classificationFilters.category?.trim();
    if (cat) {
      where.categoryId = {
        in: await this.classificationIdsByName('category', tenantId, cat),
      };
    }
    const subCat = classificationFilters.subCategory?.trim();
    if (subCat) {
      where.subCategoryId = {
        in: await this.classificationIdsByName('subCategory', tenantId, subCat),
      };
    }
    return where;
  }

  /** Resolve the active catalogue-row ids whose name contains `term` (tenant-scoped). */
  private async classificationIdsByName(
    model: 'department' | 'category' | 'subCategory',
    tenantId: string,
    term: string,
  ): Promise<string[]> {
    const where = {
      tenantId,
      deletedAt: null,
      name: { contains: term, mode: 'insensitive' as const },
    };
    const select = { id: true };
    const rows =
      model === 'department'
        ? await this.prisma.department.findMany({ where, select })
        : model === 'category'
          ? await this.prisma.category.findMany({ where, select })
          : await this.prisma.subCategory.findMany({ where, select });
    return rows.map((r) => r.id);
  }

  /**
   * Resolve the list an import/sync should target: the default (Walk-in) list is
   * always ensured to exist first, then the given `listId` is used if present
   * (validated to belong to this branch) or the just-ensured default otherwise.
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
   * Resolve a set of Master Data radiology-test ids into create/update payloads
   * for the target list: a source already copied into it (matched by
   * `sourceRadiologyTestId`) is re-snapshotted (UPDATE); a new one is
   * materialized (CREATE).
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
    });
    const validById = new Map(validSources.map((s) => [s.id, s]));
    const validIds = validSources.map((s) => s.id);
    const existing = await this.prisma.branchRadiologyTest.findMany({
      where: {
        tenantId,
        branchId,
        listId: targetListId,
        deletedAt: null,
        sourceRadiologyTestId: { in: validIds },
      },
      select: { id: true, sourceRadiologyTestId: true },
    });
    const existingBySource = new Map(
      existing.map((t) => [t.sourceRadiologyTestId, t.id] as const),
    );

    const toCreate: Prisma.BranchRadiologyTestUncheckedCreateInput[] = [];
    const toUpdate: {
      id: string;
      data: Prisma.BranchRadiologyTestUncheckedUpdateInput;
    }[] = [];
    const skipped = candidateIds.length - validIds.length;
    for (const id of validIds) {
      const source = validById.get(id)!;
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
   * Re-snapshot branch radiology tests from their source Master Data tests.
   * Reloads each copy's source (via `sourceRadiologyTestId`) and OVERWRITES the
   * copy's fields with the current Master Data values — branch-level edits are
   * discarded. Copies whose source is missing/soft-deleted are soft-deleted (and
   * a sibling promoted to default if needed); copies with no source ref are
   * skipped. Writes run in fixed-size batches.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto optional subset of branch-radiology-test ids + optional `listId`
   * @returns counts of synced vs deleted vs skipped copies
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   * @throws BranchRadiologyTestListNotFoundException if `dto.listId` doesn't belong to this branch
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
      sourceRadiologyTestId: { not: null },
    };
    if (dto.branchRadiologyTestIds?.length) {
      where.id = { in: dto.branchRadiologyTestIds };
    }
    const copies = await this.prisma.branchRadiologyTest.findMany({
      where,
      select: { id: true, sourceRadiologyTestId: true, isDefault: true },
    });

    const updates: {
      id: string;
      data: Prisma.BranchRadiologyTestUncheckedUpdateInput;
    }[] = [];
    const toDelete: {
      id: string;
      isDefault: boolean;
      sourceRadiologyTestId: string | null;
    }[] = [];
    let skipped = 0;
    const resolvable = copies.filter((copy) => {
      if (!copy.sourceRadiologyTestId) {
        skipped += 1;
        return false;
      }
      return true;
    });
    const RESOLVE_CHUNK_SIZE = 25;
    for (let i = 0; i < resolvable.length; i += RESOLVE_CHUNK_SIZE) {
      const chunk = resolvable.slice(i, i + RESOLVE_CHUNK_SIZE);
      const sources = await this.prisma.radiologyTest.findMany({
        where: {
          id: { in: chunk.map((c) => c.sourceRadiologyTestId!) },
          masterDataId: masterData.id,
          tenantId,
          deletedAt: null,
        },
      });
      const sourceById = new Map(sources.map((s) => [s.id, s]));
      for (const copy of chunk) {
        const source = sourceById.get(copy.sourceRadiologyTestId!);
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
            if (d.isDefault && d.sourceRadiologyTestId) {
              const sibling = await tx.branchRadiologyTest.findFirst({
                where: {
                  tenantId,
                  branchId,
                  sourceRadiologyTestId: d.sourceRadiologyTestId,
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
   * `search` on testName/testCode, a `modality` filter, and an active `status`
   * filter.
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
    if (query.modality) {
      where.modality = query.modality;
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
   * Lightweight options for the Create-Order radiology-test selector. Returns the
   * branch's **active default-variant** rows only (one orderable row per variant
   * group), so a selected id is directly usable as an order item's
   * `branchRadiologyTestId`. `price` is the list price (`listPrice`, minor units).
   * Supports a case-insensitive `search` on testName; `preferredOnly` narrows the
   * unsearched view to `isPreferenceTest: true`.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param filters optional search + offset pagination + list scope
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
      modality: true,
      bodyPart: true,
      view: true,
      isContrast: true,
      isAllowDiscounts: true,
      isBillOnlyTest: true,
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
      modality: RadiologyModality;
      bodyPart: string | null;
      view: string | null;
      isContrast: boolean;
      isAllowDiscounts: boolean;
      isBillOnlyTest: boolean;
      scheduleDays: DayOfWeek[];
      scheduleFrom: string | null;
      scheduleTo: string | null;
      tatMinValue: number | null;
      tatMinUnit: TatUnit | null;
      tatMaxValue: number | null;
      tatMaxUnit: TatUnit | null;
    }): BranchRadiologyTestOption => ({
      id: r.id,
      name: r.testName,
      price: r.listPrice,
      modality: r.modality,
      bodyPart: r.bodyPart,
      view: r.view,
      isContrast: r.isContrast,
      isAllowDiscounts: r.isAllowDiscounts,
      isBillOnlyTest: r.isBillOnlyTest,
      scheduleDays: r.scheduleDays,
      scheduleFrom: r.scheduleFrom,
      scheduleTo: r.scheduleTo,
      tatMinValue: r.tatMinValue,
      tatMinUnit: r.tatMinUnit,
      tatMaxValue: r.tatMaxValue,
      tatMaxUnit: r.tatMaxUnit,
    });

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
   * Fetch one branch radiology test scoped to tenant+branch.
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
   * Edit a branch radiology test's branch-tunable fields (pricing, flags, TAT,
   * notes, display, active). Identity/classification are not editable here
   * (managed via re-import/sync). Validates price ordering before writing.
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
   * same group (same `sourceRadiologyTestId`). The copy starts as a non-default
   * duplicate (`isDuplicate=true`, `isDefault=false`) so it is untouched by sync;
   * its display name is suffixed " (Copy)".
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
      if (row.sourceRadiologyTestId) {
        await tx.branchRadiologyTest.updateMany({
          where: {
            tenantId,
            branchId,
            sourceRadiologyTestId: row.sourceRadiologyTestId,
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
   * Soft-delete a branch radiology test (removes it from the branch's list). If it
   * was the group's default and active siblings remain, one is promoted to
   * default so the group keeps an orderable row.
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
      if (row.isDefault && row.sourceRadiologyTestId) {
        const sibling = await tx.branchRadiologyTest.findFirst({
          where: {
            tenantId,
            branchId,
            sourceRadiologyTestId: row.sourceRadiologyTestId,
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
   * Build the create payload for a branch radiology test from a Master Data test.
   * Copies all scalars and stamps the branch scope + provenance. The flat model
   * has no children, so `configSnapshot` stays `{}`.
   * @param source the source radiology test
   * @param target branch scope + source master data + actor
   */
  buildImportData(
    source: RadiologyTest,
    target: ImportTarget,
  ): Prisma.BranchRadiologyTestUncheckedCreateInput {
    const scalars = this.extractScalars(source);
    return {
      ...scalars,
      tenantId: target.tenantId,
      branchId: target.branchId,
      sourceRadiologyTestId: source.id,
      sourceMasterDataId: target.sourceMasterDataId,
      listId: target.listId,
      // Walk-in default list: the sellable list price starts at MSRP.
      listPrice: (scalars.priceMsrp as number) ?? 0,
      configSnapshot: {},
      createdBy: target.actorId,
      updatedBy: target.actorId,
    } as Prisma.BranchRadiologyTestUncheckedCreateInput;
  }

  /**
   * Build the create payload for a duplicate from an existing branch row: copy all
   * fields except the re-derived ones, keep the same variant group
   * (`sourceRadiologyTestId`), and mark it a non-default duplicate.
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

  /** Build the overwrite (re-snapshot) update payload from a source test. */
  private buildSyncData(
    source: RadiologyTest,
    actorId: string | null,
  ): Prisma.BranchRadiologyTestUncheckedUpdateInput {
    const scalars = this.extractScalars(source);
    return {
      ...scalars,
      // Walk-in list price tracks MSRP on re-snapshot (agreed overwrite contract).
      listPrice: (scalars.priceMsrp as number) ?? 0,
      configSnapshot: {},
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
    const list = await this.prisma.branchRadiologyTestList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    return list?.id ?? '__no_list__';
  }

  /**
   * Pick the copyable scalar fields off a source test — those present on the
   * BranchRadiologyTest model, minus identity/scope/source/versioning/timestamp
   * columns that the caller sets fresh. Filtering against the BranchRadiologyTest
   * scalar-field set drops any master-only column automatically, so future
   * RadiologyTest additions can't break import/sync.
   */
  private extractScalars(source: RadiologyTest): Record<string, unknown> {
    const validFields = new Set<string>(
      Object.keys(Prisma.BranchRadiologyTestScalarFieldEnum),
    );
    const dropKeys = new Set<string>([
      'id',
      'tenantId',
      'branchId',
      'masterDataId',
      'source',
      'clonedFromId',
      'templateSyncedAt',
      'sourceMasterRadiologyTestId',
      'versionHistory',
      'approvalWorkflow',
      'isOutsource',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ]);
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (validFields.has(key) && !dropKeys.has(key)) copy[key] = value;
    }
    return copy;
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
