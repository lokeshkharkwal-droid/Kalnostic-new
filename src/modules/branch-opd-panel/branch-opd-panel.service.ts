import { Injectable } from '@nestjs/common';
import { BranchOpdPanel, Prisma, TatUnit } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { OpdMasterDataService } from '../opd-master-data/opd-master-data.service';
import { OpdPanelService } from '../opd-panel/opd-panel.service';
import { OpdTestService } from '../opd-test/opd-test.service';
import { OpdPanelWithTests } from '../opd-panel/entities/opd-panel.entity';
import { OpdPanelNotFoundException } from '../opd-panel/exceptions/opd-panel.exceptions';
import { OpdTestNotFoundException } from '../opd-test/exceptions/opd-test.exceptions';
import { BranchOpdTestService } from '../branch-opd-test/branch-opd-test.service';
import { BranchOpdTestListService } from '../branch-opd-test-list/branch-opd-test-list.service';
import { BranchOpdPanelListService } from '../branch-opd-panel-list/branch-opd-panel-list.service';
import { ImportBranchOpdPanelsDto } from './dto/import-branch-opd-panels.dto';
import { SyncBranchOpdPanelsDto } from './dto/sync-branch-opd-panels.dto';
import { ListBranchOpdPanelsQueryDto } from './dto/list-branch-opd-panels-query.dto';
import { UpdateBranchOpdPanelDto } from './dto/update-branch-opd-panel.dto';
import { BulkEditBranchOpdPanelsDto } from './dto/bulk-edit-branch-opd-panels.dto';
import {
  BranchOpdPanelDefaultConflictException,
  BranchOpdPanelNotFoundException,
} from './exceptions/branch-opd-panel.exceptions';
import {
  BranchOpdPanelImportResult,
  BranchOpdPanelListRow,
  BranchOpdPanelSyncResult,
  BranchOpdPanelWithTests,
} from './entities/branch-opd-panel.entity';
import { BranchOpdTestConfigSnapshot } from '../branch-opd-test/entities/branch-opd-test.entity';

/** Result of a bulk-edit: the number of branch opd panels updated. */
export interface BranchOpdPanelBulkEditResult {
  updated: number;
}

/** A Create-Order opd-panel option row. */
export interface BranchOpdPanelOption {
  id: string;
  name: string;
  price: number;
  sampleType: string | null;
  isFasting: boolean;
  tatMinValue: number | null;
  tatMinUnit: TatUnit | null;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
}

/** A resolved panel member: the source test id + its ordering/removable flags. */
interface MemberPlan {
  sourceLabTestId: string;
  sortOrder: number;
  isRemovable: boolean;
}

/**
 * Source keys that are re-derived (never copied) or are read-only composition when
 * materializing a branch opd panel from a composed source panel.
 */
const BRANCH_PANEL_DROP_KEYS = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'source',
  'sourceMasterLabPanelId',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'category',
  'department',
  'tests',
];

/**
 * A branch's operational **Opd Panel List** — materialized, independent
 * snapshots of the branch's Master Data opd panels. Tenant-scoped +
 * branch-level; tenant/branch come from the JWT. A panel's member tests are
 * materialized into the branch's `BranchOpdTest` list (reusing existing copies
 * where present). Source rows are composed BEFORE opening a `withTenant` tx.
 */
@Injectable()
export class BranchOpdPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: OpdMasterDataService,
    private readonly opdPanelService: OpdPanelService,
    private readonly opdTestService: OpdTestService,
    private readonly branchOpdTestService: BranchOpdTestService,
    private readonly testListService: BranchOpdTestListService,
    private readonly panelListService: BranchOpdPanelListService,
  ) {}

  /**
   * Persist-import the selected Master Data opd panels into the active branch's
   * Opd Panel List. Each panel's member tests are materialized as
   * `BranchOpdTest` copies (existing copies of the same source are reused).
   * Idempotent: a panel already in the target list (matched by `sourceLabPanelId`) is
   * re-snapshotted; a new one is materialized.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the source panel ids to import, plus an optional target `listId`
   */
  async importFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: ImportBranchOpdPanelsDto,
  ): Promise<BranchOpdPanelImportResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    const { targetPanelList, walkInTest } = await this.resolveImportTargets(
      tenantId,
      branchId,
      actorId,
      dto.listId,
    );
    const branchTestBySource = await this.loadBranchTestMap(
      tenantId,
      branchId,
      walkInTest.id,
    );
    const plan = await this.buildPanelImportPlan(
      masterData.id,
      tenantId,
      branchId,
      targetPanelList.id,
      walkInTest.id,
      actorId,
      dto.labPanelIds,
      branchTestBySource,
    );
    await this.writePanelImportPlan(
      tenantId,
      branchId,
      plan.panelsToCreate,
      plan.panelsToUpdate,
      plan.newTests,
      branchTestBySource,
    );
    return {
      copied: plan.panelsToCreate.length,
      updated: plan.panelsToUpdate.length,
      skipped: plan.skipped,
    };
  }

  /**
   * Import every Master Data opd panel matching the given search/classification
   * filters (server-resolved) into the active branch's Opd Panel List ("select
   * all"). Mirrors {@link importFromMasterData}'s semantics; writes commit in
   * fixed-size batches. The member-test dedup map is threaded across every batch.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the search/classification filters plus an optional target `listId`
   * @returns counts of copied vs updated panels
   */
  async importFromMasterDataByFilter(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: {
      search?: string;
      department?: string;
      category?: string;
      listId?: string;
    },
  ): Promise<BranchOpdPanelImportResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    const { targetPanelList, walkInTest } = await this.resolveImportTargets(
      tenantId,
      branchId,
      actorId,
      dto.listId,
    );
    const where = await this.masterDataService.buildImportablePanelWhere(
      masterData.id,
      tenantId,
      dto.search,
      { department: dto.department, category: dto.category },
      targetPanelList.id,
    );
    const matches = await this.prisma.opdPanel.findMany({
      where,
      select: { id: true },
    });
    const ids = matches.map((m) => m.id);

    const branchTestBySource = await this.loadBranchTestMap(
      tenantId,
      branchId,
      walkInTest.id,
    );

    let copied = 0;
    let updated = 0;
    const WRITE_BATCH_SIZE = 25;
    for (let i = 0; i < ids.length; i += WRITE_BATCH_SIZE) {
      const batchIds = ids.slice(i, i + WRITE_BATCH_SIZE);
      const plan = await this.buildPanelImportPlan(
        masterData.id,
        tenantId,
        branchId,
        targetPanelList.id,
        walkInTest.id,
        actorId,
        batchIds,
        branchTestBySource,
      );
      await this.writePanelImportPlan(
        tenantId,
        branchId,
        plan.panelsToCreate,
        plan.panelsToUpdate,
        plan.newTests,
        branchTestBySource,
      );
      copied += plan.panelsToCreate.length;
      updated += plan.panelsToUpdate.length;
    }
    return { copied, updated, skipped: 0 };
  }

  /**
   * Resolve the panel list + member-test list an import/sync should target. Member
   * tests always materialize into the (Walk-in) test list.
   */
  private async resolveImportTargets(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    listId?: string,
  ) {
    const defaultPanelList = await this.panelListService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const targetPanelList = listId
      ? await this.panelListService.findById(listId, tenantId, branchId)
      : defaultPanelList;
    const walkInTest = await this.testListService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    return { targetPanelList, walkInTest };
  }

  /**
   * Resolve a set of Master Data panel ids into create/update plans for the target
   * list, queuing any not-yet-copied member tests into `newTests`.
   */
  private async buildPanelImportPlan(
    masterDataId: string,
    tenantId: string,
    branchId: string,
    targetPanelListId: string,
    walkInTestListId: string,
    actorId: string | null,
    candidateIds: string[],
    branchTestBySource: Map<string, string>,
  ): Promise<{
    panelsToCreate: {
      data: Prisma.BranchOpdPanelUncheckedCreateInput;
      members: MemberPlan[];
    }[];
    panelsToUpdate: {
      id: string;
      data: Prisma.BranchOpdPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[];
    newTests: Map<string, Prisma.BranchOpdTestUncheckedCreateInput>;
    skipped: number;
  }> {
    const validPanels = await this.prisma.opdPanel.findMany({
      where: {
        id: { in: candidateIds },
        masterDataId,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const validIds = validPanels.map((p) => p.id);
    const existing = await this.prisma.branchOpdPanel.findMany({
      where: {
        tenantId,
        branchId,
        listId: targetPanelListId,
        deletedAt: null,
        sourceLabPanelId: { in: validIds },
      },
      select: { id: true, sourceLabPanelId: true },
    });
    const existingBySource = new Map(
      existing.map((p) => [p.sourceLabPanelId, p.id] as const),
    );

    const newTests = new Map<
      string,
      Prisma.BranchOpdTestUncheckedCreateInput
    >();
    const panelsToCreate: {
      data: Prisma.BranchOpdPanelUncheckedCreateInput;
      members: MemberPlan[];
    }[] = [];
    const panelsToUpdate: {
      id: string;
      data: Prisma.BranchOpdPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[] = [];
    const skipped = candidateIds.length - validIds.length;

    for (const id of validIds) {
      const panel = await this.opdPanelService.findById(
        masterDataId,
        id,
        tenantId,
      );
      const members = await this.planMembers(
        masterDataId,
        tenantId,
        branchId,
        actorId,
        panel,
        branchTestBySource,
        newTests,
        walkInTestListId,
      );
      const existingId = existingBySource.get(id);
      if (existingId) {
        panelsToUpdate.push({
          id: existingId,
          data: this.buildPanelSyncData(panel, actorId),
          members,
        });
      } else {
        panelsToCreate.push({
          data: this.buildPanelImportData(panel, {
            tenantId,
            branchId,
            sourceMasterDataId: masterDataId,
            listId: targetPanelListId,
            actorId,
          }),
          members,
        });
      }
    }
    return { panelsToCreate, panelsToUpdate, newTests, skipped };
  }

  /** Apply a resolved panel create/update plan (+ queued member tests) in one transaction. */
  private async writePanelImportPlan(
    tenantId: string,
    branchId: string,
    panelsToCreate: {
      data: Prisma.BranchOpdPanelUncheckedCreateInput;
      members: MemberPlan[];
    }[],
    panelsToUpdate: {
      id: string;
      data: Prisma.BranchOpdPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[],
    newTests: Map<string, Prisma.BranchOpdTestUncheckedCreateInput>,
    branchTestBySource: Map<string, string>,
  ): Promise<void> {
    if (!panelsToCreate.length && !panelsToUpdate.length) return;
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await this.persistNewTests(tx, newTests, branchTestBySource);
        for (const p of panelsToCreate) {
          const panel = await tx.branchOpdPanel.create({ data: p.data });
          await this.createJoins(
            tx,
            tenantId,
            branchId,
            panel.id,
            p.members,
            branchTestBySource,
          );
        }
        for (const p of panelsToUpdate) {
          await tx.branchOpdPanel.update({
            where: { id: p.id },
            data: p.data,
          });
          await tx.branchOpdPanelTest.updateMany({
            where: { branchLabPanelId: p.id, tenantId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          await this.createJoins(
            tx,
            tenantId,
            branchId,
            p.id,
            p.members,
            branchTestBySource,
          );
        }
      });
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
  }

  /**
   * Re-snapshot branch opd panels from their source Master Data panels.
   * Reloads each copy's source (via `sourceLabPanelId`), OVERWRITES the copy's fields,
   * and rebuilds its member tests. Copies whose source is gone are removed.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto optional subset of branch-panel ids to sync + optional target `listId`
   */
  async syncFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: SyncBranchOpdPanelsDto,
  ): Promise<BranchOpdPanelSyncResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    const defaultPanelList = await this.panelListService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const targetPanelList = dto.listId
      ? await this.panelListService.findById(dto.listId, tenantId, branchId)
      : defaultPanelList;
    const walkInTest = await this.testListService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const where: Prisma.BranchOpdPanelWhereInput = {
      tenantId,
      branchId,
      listId: targetPanelList.id,
      deletedAt: null,
      isDuplicate: false,
      sourceLabPanelId: { not: null },
    };
    if (dto.branchLabPanelIds?.length) {
      where.id = { in: dto.branchLabPanelIds };
    }
    const copies = await this.prisma.branchOpdPanel.findMany({
      where,
      select: { id: true, sourceLabPanelId: true, isDefault: true },
    });

    const branchTestBySource = await this.loadBranchTestMap(
      tenantId,
      branchId,
      walkInTest.id,
    );
    const newTests = new Map<
      string,
      Prisma.BranchOpdTestUncheckedCreateInput
    >();
    const plans: {
      id: string;
      data: Prisma.BranchOpdPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[] = [];
    const toDelete: {
      id: string;
      isDefault: boolean;
      sourceLabPanelId: string | null;
    }[] = [];
    let skipped = 0;

    for (const copy of copies) {
      if (!copy.sourceLabPanelId) {
        skipped += 1;
        continue;
      }
      try {
        const panel = await this.opdPanelService.findById(
          masterData.id,
          copy.sourceLabPanelId,
          tenantId,
        );
        const members = await this.planMembers(
          masterData.id,
          tenantId,
          branchId,
          actorId,
          panel,
          branchTestBySource,
          newTests,
          walkInTest.id,
        );
        plans.push({
          id: copy.id,
          data: this.buildPanelSyncData(panel, actorId),
          members,
        });
      } catch (e) {
        if (e instanceof OpdPanelNotFoundException) {
          toDelete.push(copy);
          continue;
        }
        throw e;
      }
    }

    if (plans.length || toDelete.length) {
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          await this.persistNewTests(tx, newTests, branchTestBySource);
          for (const plan of plans) {
            await tx.branchOpdPanel.update({
              where: { id: plan.id },
              data: plan.data,
            });
            await tx.branchOpdPanelTest.updateMany({
              where: {
                branchLabPanelId: plan.id,
                tenantId,
                deletedAt: null,
              },
              data: { deletedAt: new Date() },
            });
            await this.createJoins(
              tx,
              tenantId,
              branchId,
              plan.id,
              plan.members,
              branchTestBySource,
            );
          }
          for (const d of toDelete) {
            const now = new Date();
            await tx.branchOpdPanelTest.updateMany({
              where: { branchLabPanelId: d.id, tenantId, deletedAt: null },
              data: { deletedAt: now },
            });
            await tx.branchOpdPanel.update({
              where: { id: d.id },
              data: { deletedAt: now },
            });
            if (d.isDefault && d.sourceLabPanelId) {
              const sibling = await tx.branchOpdPanel.findFirst({
                where: {
                  tenantId,
                  branchId,
                  sourceLabPanelId: d.sourceLabPanelId,
                  deletedAt: null,
                },
                orderBy: { createdAt: 'asc' },
              });
              if (sibling) {
                await tx.branchOpdPanel.update({
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
    return { synced: plans.length, deleted: toDelete.length, skipped };
  }

  /**
   * List the branch's Opd Panel List (paginated + search + status).
   */
  async findAll(
    tenantId: string,
    branchId: string,
    query: ListBranchOpdPanelsQueryDto,
  ): Promise<PaginatedResult<BranchOpdPanelListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.BranchOpdPanelWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
    where.listId =
      query.listId ?? (await this.resolveListId(tenantId, branchId));
    const term = query.search?.trim();
    if (term) {
      where.OR = [
        { panelName: { contains: term, mode: 'insensitive' } },
        { panelCode: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }
    const [data, total] = await Promise.all([
      this.prisma.branchOpdPanel.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { panelName: 'asc' },
      }),
      this.prisma.branchOpdPanel.count({ where }),
    ]);
    const [sampleSummaries, deptNames, catNames] = await Promise.all([
      this.resolveSampleSummaries(data.map((p) => p.id)),
      this.resolveClassificationNames(
        'department',
        tenantId,
        data.map((p) => p.departmentId),
      ),
      this.resolveClassificationNames(
        'category',
        tenantId,
        data.map((p) => p.categoryId),
      ),
    ]);
    const enriched: BranchOpdPanelListRow[] = data.map((p) => ({
      ...p,
      sampleSummary: sampleSummaries.get(p.id) ?? null,
      departmentName: this.nameOfClassification(deptNames, p.departmentId),
      categoryName: this.nameOfClassification(catNames, p.categoryId),
    }));
    return { data: enriched, total, page, limit };
  }

  /**
   * Resolve a set of classification ids to a `id → name` map (tenant-scoped).
   */
  private async resolveClassificationNames(
    model: 'department' | 'category',
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
        : await this.prisma.category.findMany({ where, select });
    for (const r of rows) {
      map.set(r.id, r.name);
    }
    return map;
  }

  /** Look up a resolved classification name by (possibly null) id. */
  private nameOfClassification(
    map: Map<string, string>,
    id: string | null,
  ): string | null {
    return id ? (map.get(id) ?? null) : null;
  }

  /**
   * Aggregate each panel's member-test sample types into one comma-joined summary
   * string, keyed by `branchLabPanelId`. Samples live on each member `BranchOpdTest`.
   */
  private async resolveSampleSummaries(
    labPanelIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (labPanelIds.length === 0) {
      return map;
    }
    const memberRows = await this.prisma.branchOpdPanelTest.findMany({
      where: { branchLabPanelId: { in: labPanelIds }, deletedAt: null },
      select: { branchLabPanelId: true, branchLabTestId: true },
    });
    const labTestIds = [...new Set(memberRows.map((r) => r.branchLabTestId))];
    if (labTestIds.length === 0) {
      return map;
    }
    const tests = await this.prisma.branchOpdTest.findMany({
      where: { id: { in: labTestIds } },
      select: { id: true, configSnapshot: true },
    });
    const sampleTypesByTestId = new Map<string, string[]>();
    for (const t of tests) {
      const samples =
        (t.configSnapshot as unknown as BranchOpdTestConfigSnapshot)?.samples ??
        [];
      sampleTypesByTestId.set(
        t.id,
        samples.map((s) => s.sampleType).filter((x): x is string => Boolean(x)),
      );
    }
    const sampleTypesByPanelId = new Map<string, Set<string>>();
    for (const r of memberRows) {
      const set =
        sampleTypesByPanelId.get(r.branchLabPanelId) ?? new Set<string>();
      for (const st of sampleTypesByTestId.get(r.branchLabTestId) ?? []) {
        set.add(st);
      }
      sampleTypesByPanelId.set(r.branchLabPanelId, set);
    }
    for (const [labPanelId, set] of sampleTypesByPanelId) {
      if (set.size > 0) {
        map.set(labPanelId, [...set].join(', '));
      }
    }
    return map;
  }

  /**
   * Lightweight options for the Create-Order opd-panel selector — the branch's
   * active default-variant rows only. A panel has no single specimen so `sampleType`
   * is always `null`, and `isFasting` reflects `isFastingRequired`. `preferredOnly`
   * narrows to `isPreference` when set AND no `search` term is given.
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
    Array<BranchOpdPanelOption> | PaginatedResult<BranchOpdPanelOption>
  > {
    const where: Prisma.BranchOpdPanelWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
      isActive: true,
      isDefault: true,
      listId: filters.listId ?? (await this.resolveListId(tenantId, branchId)),
    };
    const term = filters.search?.trim();
    if (term) {
      where.panelName = { contains: term, mode: 'insensitive' };
    } else if (filters.preferredOnly) {
      where.isPreference = true;
    }

    const select = {
      id: true,
      panelName: true,
      listPrice: true,
      isFastingRequired: true,
      tatMinValue: true,
      tatMinUnit: true,
      tatMaxValue: true,
      tatMaxUnit: true,
    } as const;
    const orderBy = { panelName: 'asc' } as const;
    const toOption = (r: {
      id: string;
      panelName: string;
      listPrice: number;
      isFastingRequired: boolean;
      tatMinValue: number | null;
      tatMinUnit: TatUnit | null;
      tatMaxValue: number | null;
      tatMaxUnit: TatUnit | null;
    }): BranchOpdPanelOption => ({
      id: r.id,
      name: r.panelName,
      price: r.listPrice,
      sampleType: null,
      isFasting: r.isFastingRequired,
      tatMinValue: r.tatMinValue,
      tatMinUnit: r.tatMinUnit,
      tatMaxValue: r.tatMaxValue,
      tatMaxUnit: r.tatMaxUnit,
    });

    if (filters.page === undefined) {
      const rows = await this.prisma.branchOpdPanel.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map(toOption);
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.branchOpdPanel.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.branchOpdPanel.count({ where }),
    ]);
    return { data: rows.map(toOption), total, page, limit };
  }

  /**
   * Fetch one branch opd panel composed with its included branch-test rows.
   * @throws BranchOpdPanelNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchOpdPanelWithTests> {
    const panel = await this.prisma.branchOpdPanel.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!panel) {
      throw new BranchOpdPanelNotFoundException(id);
    }
    const tests = await this.prisma.branchOpdPanelTest.findMany({
      where: { branchLabPanelId: id, tenantId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return { ...panel, tests };
  }

  /**
   * Edit a branch opd panel's branch-tunable fields. Validates price ordering.
   * @throws BranchOpdPanelNotFoundException if missing
   * @throws ValidationException if merged prices violate min ≤ max ≤ msrp
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: UpdateBranchOpdPanelDto,
  ): Promise<BranchOpdPanelWithTests> {
    const current = await this.findById(id, tenantId, branchId);
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? current.priceMsrp,
      priceMaximum: dto.priceMaximum ?? current.priceMaximum,
      priceMinimum: dto.priceMinimum ?? current.priceMinimum,
    });
    await this.prisma.branchOpdPanel.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
    });
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Bulk-edit branch opd panels. All checks run before the transaction opens.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto the array of per-row edits
   * @returns the number of branch opd panels updated
   */
  async bulkUpdate(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: BulkEditBranchOpdPanelsDto,
  ): Promise<BranchOpdPanelBulkEditResult> {
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

    const rows = await this.prisma.branchOpdPanel.findMany({
      where: { id: { in: ids }, tenantId, branchId, deletedAt: null },
    });
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const missing = ids.find((id) => !rowById.has(id));
    if (missing) {
      throw new BranchOpdPanelNotFoundException(missing);
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
        await tx.branchOpdPanel.update({
          where: { id },
          data: { ...data, updatedBy: actorId },
        });
      }
    });
    return { updated: edits.length };
  }

  /**
   * Enable/disable a branch opd panel in the branch's Opd Panel List.
   * @throws BranchOpdPanelNotFoundException if missing
   */
  async setActive(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    isActive: boolean,
  ): Promise<BranchOpdPanel> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.branchOpdPanel.update({
      where: { id },
      data: { isActive, updatedBy: actorId },
    });
  }

  /**
   * Duplicate a branch opd panel into an independent variant in the same group.
   * Member join rows are copied, still referencing the same branch-test copies.
   * @throws BranchOpdPanelNotFoundException if the source panel is missing
   */
  async duplicate(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchOpdPanelWithTests> {
    const panel = await this.findById(id, tenantId, branchId);
    const newId = await this.prisma.withTenant(tenantId, async (tx) => {
      const created = await tx.branchOpdPanel.create({
        data: this.buildPanelDuplicateData(panel, actorId),
      });
      if (panel.tests.length) {
        await tx.branchOpdPanelTest.createMany({
          data: panel.tests.map((t) => ({
            tenantId,
            branchId,
            branchLabPanelId: created.id,
            branchLabTestId: t.branchLabTestId,
            sortOrder: t.sortOrder,
            isRemovable: t.isRemovable,
          })),
        });
      }
      return created.id;
    });
    return this.findById(newId, tenantId, branchId);
  }

  /**
   * Mark a branch opd panel as its variant group's default. Clears `isDefault`
   * on the group's other active rows first, then sets this one.
   * @throws BranchOpdPanelNotFoundException if missing
   */
  async setDefault(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchOpdPanel> {
    const panel = await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (panel.sourceLabPanelId) {
        await tx.branchOpdPanel.updateMany({
          where: {
            tenantId,
            branchId,
            sourceLabPanelId: panel.sourceLabPanelId,
            deletedAt: null,
            isDefault: true,
            id: { not: id },
          },
          data: { isDefault: false },
        });
      }
      return tx.branchOpdPanel.update({
        where: { id },
        data: { isDefault: true, updatedBy: actorId },
      });
    });
  }

  /**
   * Soft-delete a branch opd panel (and its member join rows). If it was the
   * group's default and active siblings remain, one is promoted to default.
   * @throws BranchOpdPanelNotFoundException if missing
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchOpdPanel> {
    const panel = await this.findById(id, tenantId, branchId);
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.branchOpdPanelTest.updateMany({
        where: { branchLabPanelId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      const deleted = await tx.branchOpdPanel.update({
        where: { id },
        data: { deletedAt: now },
      });
      if (panel.isDefault && panel.sourceLabPanelId) {
        const sibling = await tx.branchOpdPanel.findFirst({
          where: {
            tenantId,
            branchId,
            sourceLabPanelId: panel.sourceLabPanelId,
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (sibling) {
          await tx.branchOpdPanel.update({
            where: { id: sibling.id },
            data: { isDefault: true },
          });
        }
      }
      return deleted;
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Map of existing active branch-test copies in the given test list, keyed by their
   * source opd test id (so panel members reuse the Walk-in test copies).
   */
  private async loadBranchTestMap(
    tenantId: string,
    branchId: string,
    testListId: string,
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.branchOpdTest.findMany({
      where: {
        tenantId,
        branchId,
        listId: testListId,
        deletedAt: null,
        sourceLabTestId: { not: null },
      },
      select: { id: true, sourceLabTestId: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.sourceLabTestId) {
        map.set(r.sourceLabTestId, r.id);
      }
    }
    return map;
  }

  /**
   * Resolve a source panel's member tests into `MemberPlan`s, queuing any member
   * whose branch-test copy doesn't yet exist for creation. Members whose source test
   * is missing are dropped.
   */
  private async planMembers(
    masterDataId: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    panel: OpdPanelWithTests,
    branchTestBySource: Map<string, string>,
    newTests: Map<string, Prisma.BranchOpdTestUncheckedCreateInput>,
    testListId: string,
  ): Promise<MemberPlan[]> {
    const members: MemberPlan[] = [];
    for (const t of panel.tests) {
      members.push({
        sourceLabTestId: t.labTestId,
        sortOrder: t.sortOrder,
        isRemovable: t.isRemovable,
      });
      if (branchTestBySource.has(t.labTestId) || newTests.has(t.labTestId)) {
        continue;
      }
      try {
        const srcTest = await this.opdTestService.findById(
          masterDataId,
          t.labTestId,
          tenantId,
        );
        newTests.set(
          t.labTestId,
          this.branchOpdTestService.buildImportData(srcTest, {
            tenantId,
            branchId,
            sourceMasterDataId: masterDataId,
            listId: testListId,
            actorId,
          }),
        );
      } catch (e) {
        if (!(e instanceof OpdTestNotFoundException)) {
          throw e;
        }
        // Source test missing → its join is dropped when created (no mapping).
      }
    }
    return members;
  }

  /** Create the queued branch-test copies inside `tx`, recording their new ids. */
  private async persistNewTests(
    tx: Prisma.TransactionClient,
    newTests: Map<string, Prisma.BranchOpdTestUncheckedCreateInput>,
    branchTestBySource: Map<string, string>,
  ): Promise<void> {
    for (const [sourceLabTestId, data] of newTests) {
      const created = await tx.branchOpdTest.create({ data });
      branchTestBySource.set(sourceLabTestId, created.id);
    }
  }

  /** Create the panel's member join rows, skipping members with no branch-test copy. */
  private async createJoins(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    branchLabPanelId: string,
    members: MemberPlan[],
    branchTestBySource: Map<string, string>,
  ): Promise<void> {
    const data = members
      .map((m) => {
        const branchLabTestId = branchTestBySource.get(m.sourceLabTestId);
        if (!branchLabTestId) {
          return null;
        }
        return {
          tenantId,
          branchId,
          branchLabPanelId,
          branchLabTestId,
          sortOrder: m.sortOrder,
          isRemovable: m.isRemovable,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (data.length) {
      await tx.branchOpdPanelTest.createMany({ data });
    }
  }

  /** Build the create payload for a branch opd panel from a composed source panel. */
  private buildPanelImportData(
    source: OpdPanelWithTests,
    target: {
      tenantId: string;
      branchId: string;
      sourceMasterDataId: string;
      listId: string;
      actorId: string | null;
    },
  ): Prisma.BranchOpdPanelUncheckedCreateInput {
    const scalars = this.extractScalars(source);
    return {
      ...scalars,
      tenantId: target.tenantId,
      branchId: target.branchId,
      sourceLabPanelId: source.id,
      sourceMasterDataId: target.sourceMasterDataId,
      listId: target.listId,
      listPrice: (scalars.priceMsrp as number) ?? 0,
      createdBy: target.actorId,
      updatedBy: target.actorId,
    } as Prisma.BranchOpdPanelUncheckedCreateInput;
  }

  /**
   * Resolve the branch's default (Walk-in) panel list id for an unscoped read.
   * Returns a non-matching sentinel when the branch has never imported.
   */
  private async resolveListId(
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const list = await this.prisma.branchOpdPanelList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    return list?.id ?? '__no_list__';
  }

  /** Build the create payload for a duplicate from an existing branch panel row. */
  private buildPanelDuplicateData(
    panel: BranchOpdPanelWithTests,
    actorId: string | null,
  ): Prisma.BranchOpdPanelUncheckedCreateInput {
    const copy: Record<string, unknown> = { ...panel };
    for (const key of ['id', 'createdAt', 'updatedAt', 'deletedAt', 'tests']) {
      delete copy[key];
    }
    return {
      ...copy,
      isDefault: false,
      isDuplicate: true,
      panelName: `${panel.panelName} (Copy)`,
      createdBy: actorId,
      updatedBy: actorId,
    } as Prisma.BranchOpdPanelUncheckedCreateInput;
  }

  /** Build the overwrite (re-snapshot) update payload from a composed source panel. */
  private buildPanelSyncData(
    source: OpdPanelWithTests,
    actorId: string | null,
  ): Prisma.BranchOpdPanelUncheckedUpdateInput {
    const scalars = this.extractScalars(source);
    return {
      ...scalars,
      listPrice: (scalars.priceMsrp as number) ?? 0,
      updatedBy: actorId,
    };
  }

  /** Drop re-derived/scope keys and the read-only refs/tests from a composed panel. */
  private extractScalars(source: OpdPanelWithTests): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...source };
    for (const key of BRANCH_PANEL_DROP_KEYS) {
      delete copy[key];
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

  /** Strip undefined keys from one bulk-edit item's changes, yielding a Prisma update. */
  private pickDefined(
    changes: Omit<BulkEditBranchOpdPanelsDto['data'][number], 'id'>,
  ): Prisma.BranchOpdPanelUncheckedUpdateInput {
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
      throw new BranchOpdPanelDefaultConflictException();
    }
  }
}
