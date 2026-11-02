import { Injectable } from '@nestjs/common';
import {
  BranchLabPanel,
  DayOfWeek,
  Prisma,
  SamplePriority,
  TatUnit,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ListPricingConfig,
  SourcePriceColumns,
  resolveImportListPrice,
  resolveSyncListPrice,
} from '../../common/utils/list-price.util';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { LabPanelService } from '../lab-panel/lab-panel.service';
import { LabTestService } from '../lab-test/lab-test.service';
import { LabPanelWithTests } from '../lab-panel/entities/lab-panel.entity';
import { LabTestNotFoundException } from '../lab-test/exceptions/lab-test.exceptions';
import { MasterDataSyncProgressListener } from '../lab-test/master-data-sync-progress';
import { BranchLabTestService } from '../branch-lab-test/branch-lab-test.service';
import { BranchLabTestListService } from '../branch-lab-test-list/branch-lab-test-list.service';
import { BranchLabPanelListService } from '../branch-lab-panel-list/branch-lab-panel-list.service';
import { ImportBranchLabPanelsDto } from './dto/import-branch-lab-panels.dto';
import { SyncBranchLabPanelsDto } from './dto/sync-branch-lab-panels.dto';
import { ListBranchLabPanelsQueryDto } from './dto/list-branch-lab-panels-query.dto';
import { UpdateBranchLabPanelDto } from './dto/update-branch-lab-panel.dto';
import { BulkEditBranchLabPanelsDto } from './dto/bulk-edit-branch-lab-panels.dto';
import {
  BranchLabPanelDefaultConflictException,
  BranchLabPanelNotFoundException,
} from './exceptions/branch-lab-panel.exceptions';
import {
  BranchLabPanelImportResult,
  BranchLabPanelListRow,
  BranchLabPanelSyncResult,
  BranchLabPanelWithTests,
} from './entities/branch-lab-panel.entity';
import { BranchLabTestConfigSnapshot } from '../branch-lab-test/entities/branch-lab-test.entity';

/** Result of a bulk-edit: the number of branch lab panels updated. */
export interface BranchLabPanelBulkEditResult {
  updated: number;
}

/** A Create-Order lab-panel option row (Diagnostic Items table). */
export interface BranchLabPanelOption {
  id: string;
  name: string;
  price: number;
  sampleType: string | null;
  isFasting: boolean;
  /**
   * Whether discounts may be applied to this panel — derived from the inverted
   * `isDisableDiscount` so the Create-Order discount input reads one uniform flag
   * for both tests and panels.
   */
  isAllowDiscounts: boolean;
  /** Billed-only panel: excluded from the lab workflow (no sample/report). */
  isBillOnlyTest: boolean;
  tatMinValue: number | null;
  tatMinUnit: TatUnit | null;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
}

/**
 * One member test of a branch lab panel, shaped for the Create-Order Diagnostic
 * Items table's expandable panel rows. Carries the per-test display fields the
 * table shows (sample name, schedule, fasting, STAT, schedule days, TAT) plus
 * `isRemovable` (from the `BranchLabPanelTest` junction) so the UI knows whether
 * its de-select checkbox may be unchecked. `branchLabTestId` is the member's
 * BranchLabTest id — what the order line submits in `selectedMemberBranchLabTestIds`.
 */
export interface BranchLabPanelMemberTest {
  branchLabTestId: string;
  name: string;
  sampleName: string | null;
  sampleType: string | null;
  isFasting: boolean;
  /** ROUTINE | URGENT | STAT — drives the "STAT" badge. */
  samplePriorityType: SamplePriority;
  scheduleDays: DayOfWeek[];
  scheduleFrom: string | null;
  scheduleTo: string | null;
  tatMinValue: number | null;
  tatMinUnit: TatUnit | null;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  /** Whether this member may be de-selected (BranchLabPanelTest.isRemovable). */
  isRemovable: boolean;
  /** Billed-only member: no sample/report even when selected. */
  isBillOnlyTest: boolean;
}

/**
 * A branch lab panel's member tests + its partial-billing controls, for the
 * expandable Create-Order panel row. `isAllowPartialBilling`/`maxTestsRemovable`
 * come from the panel; the UI uses them (with each member's `isRemovable`) to gate
 * de-selection. Members are returned in the panel's own `sortOrder`.
 */
export interface BranchLabPanelMembers {
  panelId: string;
  isAllowPartialBilling: boolean;
  maxTestsRemovable: number;
  members: BranchLabPanelMemberTest[];
}

/** A resolved panel member: the source test id + its ordering/removable flags. */
interface MemberPlan {
  sourceTestId: string;
  sortOrder: number;
  isRemovable: boolean;
}

/**
 * Source keys that are re-derived (never copied) or are read-only composition
 * (refs/tests) when materializing a branch lab panel from a composed source panel.
 */
const BRANCH_PANEL_DROP_KEYS = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'source',
  // Master Data provenance column that doesn't exist on BranchLabPanel — must be
  // dropped or Prisma rejects it as an unknown arg on create/update.
  'sourceMasterLabPanelId',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'category',
  'department',
  'tests',
];

/**
 * A branch's operational **Lab Panel List** — materialized, independent snapshots
 * of the branch's Master Data lab panels. Tenant-scoped + branch-level; tenant/
 * branch come from the JWT. A panel's member tests are materialized into the
 * branch's `BranchLabTest` list (reusing existing copies where present) so the
 * branch panel references branch-owned tests. Sync overwrites a copy from its
 * source and rebuilds its member composition. Source rows are composed BEFORE
 * opening a `withTenant` tx (nested service reads need the per-op RLS GUC).
 */
@Injectable()
export class BranchLabPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: MasterDataService,
    private readonly labPanelService: LabPanelService,
    private readonly labTestService: LabTestService,
    private readonly branchLabTestService: BranchLabTestService,
    private readonly testListService: BranchLabTestListService,
    private readonly panelListService: BranchLabPanelListService,
  ) {}

  /**
   * Persist-import the selected Master Data lab panels into the active branch's
   * Lab Panel List. Each panel is deep-copied as the group's imported original
   * (`isDefault=true`, `isDuplicate=false`); its member tests are materialized as
   * `BranchLabTest` copies (existing copies of the same source are reused).
   * Idempotent: a panel whose variant group already has an active row (matched by
   * `sourceLabPanelId`) is skipped, as is any id not in the branch's master data.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the source lab-panel ids to import, plus an optional target `listId`
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   * @throws BranchLabPanelListNotFoundException if `dto.listId` doesn't belong to this branch
   */
  async importFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: ImportBranchLabPanelsDto,
  ): Promise<BranchLabPanelImportResult> {
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
      targetPanelList,
      walkInTest,
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
   * Import every Master Data lab panel matching the given search/
   * classification filters (server-resolved — no client-supplied id list)
   * into the active branch's Lab Panel List. Mirrors {@link importFromMasterData}'s
   * create/update/member-materialization semantics exactly; writes commit in
   * fixed-size batches (not one transaction) so a "select all" spanning
   * thousands of panels can't become a single all-or-nothing write — same
   * pattern as `BranchLabTestService.importFromMasterDataByFilter`. The
   * member-test dedup map (`branchTestBySource`) is threaded across every
   * batch so a test materialized in an earlier batch is reused, never
   * recreated, by a later one.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the search/classification filters (mirrors the import-picker's
   *   "Available to Add" query) plus an optional target `listId`
   * @returns counts of copied vs updated panels (no "skipped" — every matched
   *   id is by definition a real Master Data panel)
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   * @throws BranchLabPanelListNotFoundException if `dto.listId` doesn't belong to this branch
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
  ): Promise<BranchLabPanelImportResult> {
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
    const where = await this.masterDataService.buildImportableLabPanelWhere(
      masterData.id,
      tenantId,
      dto.search,
      { department: dto.department, category: dto.category },
      targetPanelList.id,
    );
    const matches = await this.prisma.labPanel.findMany({
      where,
      select: { id: true },
    });
    const ids = matches.map((m) => m.id);

    // Threaded across every batch so a member test materialized in an
    // earlier batch is found (not recreated) by a later one.
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
        targetPanelList,
        walkInTest,
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
   * Resolve the panel list + member-test list an import/sync should target.
   * The default (Walk-in) panel list is always ensured first, same as tests;
   * `listId` (if given) is validated to belong to this branch, else the
   * just-ensured default is used. Member tests always materialize into the
   * (Walk-in) test list regardless of which panel list the panel itself
   * lands in — panel lists and test lists are separate, unmapped list types.
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
   * Resolve a set of Master Data lab-panel ids into create/update plans for
   * the target list (mirrors {@link BranchLabTestService}'s
   * `buildImportPlan`): a source already copied into it (matched by
   * `sourceLabPanelId`) is re-snapshotted (UPDATE); a new one is materialized
   * (CREATE). Also queues any not-yet-copied member tests into `newTests` (not
   * yet created — that happens in {@link writePanelImportPlan}, inside the
   * write transaction). Shared by {@link importFromMasterData} (client-picked
   * ids) and {@link importFromMasterDataByFilter} (server-resolved ids,
   * processed batch by batch) so both stay identical in their copy semantics.
   */
  private async buildPanelImportPlan(
    masterDataId: string,
    tenantId: string,
    branchId: string,
    targetPanelList: ListPricingConfig & { id: string },
    walkInTest: ListPricingConfig & { id: string },
    actorId: string | null,
    candidateIds: string[],
    branchTestBySource: Map<string, string>,
  ): Promise<{
    panelsToCreate: {
      data: Prisma.BranchLabPanelUncheckedCreateInput;
      members: MemberPlan[];
    }[];
    panelsToUpdate: {
      id: string;
      data: Prisma.BranchLabPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[];
    newTests: Map<string, Prisma.BranchLabTestUncheckedCreateInput>;
    skipped: number;
  }> {
    const validPanels = await this.prisma.labPanel.findMany({
      where: {
        id: { in: candidateIds },
        masterDataId,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const validIds = validPanels.map((p) => p.id);
    // Existing panels in the target list for these sources are UPDATED
    // (re-snapshot + rebuild members); new ones are ADDED — never duplicated
    // (Phase 1).
    const existing = await this.prisma.branchLabPanel.findMany({
      where: {
        tenantId,
        branchId,
        listId: targetPanelList.id,
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
      Prisma.BranchLabTestUncheckedCreateInput
    >();
    const panelsToCreate: {
      data: Prisma.BranchLabPanelUncheckedCreateInput;
      members: MemberPlan[];
    }[] = [];
    const panelsToUpdate: {
      id: string;
      data: Prisma.BranchLabPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[] = [];
    const skipped = candidateIds.length - validIds.length;

    for (const id of validIds) {
      const panel = await this.labPanelService.findById(
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
        walkInTest,
      );
      const existingId = existingBySource.get(id);
      if (existingId) {
        panelsToUpdate.push({
          id: existingId,
          data: this.buildPanelSyncData(panel, actorId, targetPanelList),
          members,
        });
      } else {
        panelsToCreate.push({
          data: this.buildPanelImportData(panel, {
            tenantId,
            branchId,
            sourceMasterDataId: masterDataId,
            listId: targetPanelList.id,
            list: targetPanelList,
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
      data: Prisma.BranchLabPanelUncheckedCreateInput;
      members: MemberPlan[];
    }[],
    panelsToUpdate: {
      id: string;
      data: Prisma.BranchLabPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[],
    newTests: Map<string, Prisma.BranchLabTestUncheckedCreateInput>,
    branchTestBySource: Map<string, string>,
  ): Promise<void> {
    if (!panelsToCreate.length && !panelsToUpdate.length) return;
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await this.persistNewTests(tx, newTests, branchTestBySource);
        for (const p of panelsToCreate) {
          const panel = await tx.branchLabPanel.create({ data: p.data });
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
          await tx.branchLabPanel.update({
            where: { id: p.id },
            data: p.data,
          });
          await tx.branchLabPanelTest.updateMany({
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
   * Reconcile a branch's **Lab Panel List** against its Master Data. Master Data is
   * the source of truth, and two operations are applied against the target list:
   * - **UPDATE** — an existing imported original whose source still exists is
   *   re-snapshotted and its member tests rebuilt from the source composition.
   * - **DELETE** — an imported original whose source no longer exists in Master
   *   Data is soft-deleted (joins retired, a sibling promoted to default if needed).
   *
   * Sync deliberately does **not** ADD panels — adding is "Import from Master Data"
   * ({@link importFromMasterData}). So `created` is always 0 (kept for a result
   * shape shared with import).
   *
   * User duplicates (`isDuplicate=true`) are never touched. Writes commit in
   * fixed-size batches and a batch that fails is counted (`failed`) and skipped so
   * the rest of the sync still runs (partial-failure tolerant). `onProgress`, when
   * given, is fed PREPARING/REMOVING/PANELS events for the background sync-job dialog.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto optional subset of existing copy ids to reconcile (omit = all
   *   copies in the list) and an optional target `listId` (omit = Walk-in)
   * @param onProgress optional progress listener (background sync job)
   * @returns counts of created (always 0) / updated / deleted panels and failed-batch items
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   * @throws BranchLabPanelListNotFoundException if `dto.listId` doesn't belong to this branch
   */
  async syncFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: SyncBranchLabPanelsDto,
    onProgress?: MasterDataSyncProgressListener,
  ): Promise<BranchLabPanelSyncResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    // The default (Walk-in) panel list + member-test list are ensured first.
    const { targetPanelList, walkInTest } = await this.resolveImportTargets(
      tenantId,
      branchId,
      actorId,
      dto.listId,
    );

    // Source of truth: the branch Master Data's currently-active lab panels.
    const sources = await this.prisma.labPanel.findMany({
      where: { masterDataId: masterData.id, tenantId, deletedAt: null },
      select: { id: true },
    });
    const sourceIds = new Set(sources.map((s) => s.id));

    // Existing imported originals in the target list (duplicates are left alone).
    const copyWhere: Prisma.BranchLabPanelWhereInput = {
      tenantId,
      branchId,
      listId: targetPanelList.id,
      deletedAt: null,
      isDuplicate: false,
    };
    if (dto.branchLabPanelIds?.length) {
      copyWhere.id = { in: dto.branchLabPanelIds };
    }
    const copies = await this.prisma.branchLabPanel.findMany({
      where: copyWhere,
      select: { id: true, sourceLabPanelId: true, isDefault: true },
    });
    const toUpdate = copies.filter(
      (c) => c.sourceLabPanelId && sourceIds.has(c.sourceLabPanelId),
    );
    const toDelete = copies.filter(
      (c) => !c.sourceLabPanelId || !sourceIds.has(c.sourceLabPanelId),
    );

    const total = toUpdate.length;
    await onProgress?.({
      type: 'tests-planned',
      total,
      toUpdate: toUpdate.length,
      toCreate: 0,
    });

    // Sync never ADDS a new panel — that is "Import from Master Data". It only
    // re-snapshots existing copies (UPDATE, rebuilding members) and removes copies
    // whose source is gone (DELETE). `created` stays 0 (shared result shape).
    const created = 0;
    let updated = 0;
    let deleted = 0;
    let failed = 0;
    const BATCH = 25;

    // ── DELETE ───────────────────────────────────────────────────────────────
    await onProgress?.({
      type: 'phase',
      phase: 'REMOVING',
      count: toDelete.length,
    });
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const batch = toDelete.slice(i, i + BATCH);
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          for (const d of batch) {
            const now = new Date();
            await tx.branchLabPanelTest.updateMany({
              where: { branchLabPanelId: d.id, tenantId, deletedAt: null },
              data: { deletedAt: now },
            });
            await tx.branchLabPanel.update({
              where: { id: d.id },
              data: { deletedAt: now, updatedBy: actorId },
            });
            if (d.isDefault && d.sourceLabPanelId) {
              const sibling = await tx.branchLabPanel.findFirst({
                where: {
                  tenantId,
                  branchId,
                  sourceLabPanelId: d.sourceLabPanelId,
                  deletedAt: null,
                },
                orderBy: { createdAt: 'asc' },
              });
              if (sibling) {
                await tx.branchLabPanel.update({
                  where: { id: sibling.id },
                  data: { isDefault: true },
                });
              }
            }
          }
        });
        deleted += batch.length;
      } catch {
        failed += batch.length;
      }
    }

    // ── UPDATE ───────────────────────────────────────────────────────────────
    await onProgress?.({ type: 'phase', phase: 'PANELS' });
    // Member-test dedup map, threaded across every batch so a test materialized
    // in an earlier batch is reused (not recreated) by a later one.
    const branchTestBySource = await this.loadBranchTestMap(
      tenantId,
      branchId,
      walkInTest.id,
    );
    let processed = 0;
    for (let i = 0; i < toUpdate.length; i += BATCH) {
      const batch = toUpdate.slice(i, i + BATCH);
      try {
        // Compose panels + plan members BEFORE opening the tx (nested service
        // reads need the per-op RLS GUC). Sequential: planMembers mutates the
        // shared dedup maps.
        const newTests = new Map<
          string,
          Prisma.BranchLabTestUncheckedCreateInput
        >();
        const items: {
          copyId: string;
          panel: LabPanelWithTests;
          members: MemberPlan[];
        }[] = [];
        for (const c of batch) {
          const panel = await this.labPanelService.findById(
            masterData.id,
            c.sourceLabPanelId!,
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
            walkInTest,
          );
          items.push({ copyId: c.id, panel, members });
        }
        await this.prisma.withTenant(tenantId, async (tx) => {
          await this.persistNewTests(tx, newTests, branchTestBySource);
          for (const { copyId, panel, members } of items) {
            await tx.branchLabPanel.update({
              where: { id: copyId },
              data: this.buildPanelSyncData(panel, actorId, targetPanelList),
            });
            // Rebuild membership: retire existing active joins, then re-create.
            await tx.branchLabPanelTest.updateMany({
              where: {
                branchLabPanelId: copyId,
                tenantId,
                deletedAt: null,
              },
              data: { deletedAt: new Date() },
            });
            await this.createJoins(
              tx,
              tenantId,
              branchId,
              copyId,
              members,
              branchTestBySource,
            );
          }
        });
        updated += batch.length;
      } catch {
        failed += batch.length;
      }
      processed += batch.length;
      await onProgress?.({ type: 'tests-processed', processed });
    }
    // Final tick so the progress bar/batch table reach 100% even when total is 0.
    await onProgress?.({ type: 'tests-processed', processed: total });

    return { created, updated, deleted, failed };
  }

  /**
   * List the branch's Lab Panel List (paginated + search + status).
   */
  async findAll(
    tenantId: string,
    branchId: string,
    query: ListBranchLabPanelsQueryDto,
  ): Promise<PaginatedResult<BranchLabPanelListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.BranchLabPanelWhereInput = {
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
        { panelName: { contains: term, mode: 'insensitive' } },
        { panelCode: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }
    const [data, total] = await Promise.all([
      this.prisma.branchLabPanel.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { panelName: 'asc' },
      }),
      this.prisma.branchLabPanel.count({ where }),
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
    const enriched: BranchLabPanelListRow[] = data.map((p) => ({
      ...p,
      sampleSummary: sampleSummaries.get(p.id) ?? null,
      departmentName: this.nameOfClassification(deptNames, p.departmentId),
      categoryName: this.nameOfClassification(catNames, p.categoryId),
    }));
    return { data: enriched, total, page, limit };
  }

  /**
   * Resolve a set of classification ids to a `id → name` map (tenant-scoped).
   * Mirrors `BranchLabTestService`'s private helper of the same shape.
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
   * Aggregate each panel's member-test sample types into one comma-joined
   * summary string, keyed by `branchLabPanelId`. Panels have no
   * `configSnapshot` of their own — samples live on each member `BranchLabTest`.
   */
  private async resolveSampleSummaries(
    panelIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (panelIds.length === 0) {
      return map;
    }
    const memberRows = await this.prisma.branchLabPanelTest.findMany({
      where: { branchLabPanelId: { in: panelIds }, deletedAt: null },
      select: { branchLabPanelId: true, branchLabTestId: true },
    });
    const testIds = [...new Set(memberRows.map((r) => r.branchLabTestId))];
    if (testIds.length === 0) {
      return map;
    }
    const tests = await this.prisma.branchLabTest.findMany({
      where: { id: { in: testIds } },
      select: { id: true, configSnapshot: true },
    });
    const sampleTypesByTestId = new Map<string, string[]>();
    for (const t of tests) {
      const samples =
        (t.configSnapshot as unknown as BranchLabTestConfigSnapshot)?.samples ??
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
    for (const [panelId, set] of sampleTypesByPanelId) {
      if (set.size > 0) {
        map.set(panelId, [...set].join(', '));
      }
    }
    return map;
  }

  /**
   * Lightweight `{ id, name, price, sampleType, isFasting }` options for the
   * Create-Order lab-panel selector. Returns the branch's **active default-variant**
   * rows only (one orderable row per variant group), so a selected id is directly
   * usable as an order item's `branchLabPanelId`. `price` is the list price
   * (`priceMsrp`, minor units); a panel has no single specimen so `sampleType` is
   * always `null`, and `isFasting` reflects the panel's `isFastingRequired`. Both
   * feed the form's Diagnostic Items table. Supports a case-insensitive `search`
   * on panelName.
   *
   * `preferredOnly` narrows to `isPreference: true` when set AND no `search`
   * term is given — used by the Create-Order picker, whose unsearched view
   * should default to the branch's curated "preferred" panels rather than the
   * full catalogue; typing a search term lifts the narrowing so any panel can
   * still be found by name. This endpoint is shared by several other pickers
   * (finance report filters, accession, lab adapters, order console) that
   * must keep seeing the full catalogue, so the narrowing is opt-in, not a
   * change in the default — omitting `preferredOnly` reproduces the prior
   * unfiltered behaviour exactly.
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
      preferredOnly?: boolean;
    } = {},
  ): Promise<
    Array<BranchLabPanelOption> | PaginatedResult<BranchLabPanelOption>
  > {
    const where: Prisma.BranchLabPanelWhereInput = {
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
      where.panelName = { contains: term, mode: 'insensitive' };
    } else if (filters.preferredOnly) {
      where.isPreference = true;
    }

    const select = {
      id: true,
      panelName: true,
      listPrice: true,
      isFastingRequired: true,
      isDisableDiscount: true,
      isBillOnlyTest: true,
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
      isDisableDiscount: boolean;
      isBillOnlyTest: boolean;
      tatMinValue: number | null;
      tatMinUnit: TatUnit | null;
      tatMaxValue: number | null;
      tatMaxUnit: TatUnit | null;
    }): BranchLabPanelOption => ({
      id: r.id,
      name: r.panelName,
      price: r.listPrice,
      sampleType: null,
      isFasting: r.isFastingRequired,
      isAllowDiscounts: !r.isDisableDiscount,
      isBillOnlyTest: r.isBillOnlyTest,
      tatMinValue: r.tatMinValue,
      tatMinUnit: r.tatMinUnit,
      tatMaxValue: r.tatMaxValue,
      tatMaxUnit: r.tatMaxUnit,
    });

    if (filters.page === undefined) {
      const rows = await this.prisma.branchLabPanel.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map(toOption);
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.branchLabPanel.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.branchLabPanel.count({ where }),
    ]);
    return { data: rows.map(toOption), total, page, limit };
  }

  /**
   * The member tests of a branch lab panel + its partial-billing controls, for
   * the expandable Create-Order Diagnostic Items row. Returns each member's
   * display fields (sample name, schedule, fasting, STAT, schedule days, TAT) and
   * `isRemovable` (from the `BranchLabPanelTest` junction), ordered by the panel's
   * own `sortOrder`. The branch is resolved from the JWT (never the body); the id
   * is validated to belong to this tenant+branch.
   * @throws BranchLabPanelNotFoundException if the panel is missing/foreign
   */
  async findMemberTests(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabPanelMembers> {
    const panel = await this.prisma.branchLabPanel.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
      select: {
        id: true,
        isAllowPartialBilling: true,
        maxTestsRemovable: true,
      },
    });
    if (!panel) {
      throw new BranchLabPanelNotFoundException(id);
    }

    const junctions = await this.prisma.branchLabPanelTest.findMany({
      where: { branchLabPanelId: id, tenantId, deletedAt: null },
      select: { branchLabTestId: true, isRemovable: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (junctions.length === 0) {
      return {
        panelId: panel.id,
        isAllowPartialBilling: panel.isAllowPartialBilling,
        maxTestsRemovable: panel.maxTestsRemovable,
        members: [],
      };
    }

    const tests = await this.prisma.branchLabTest.findMany({
      where: {
        id: { in: junctions.map((j) => j.branchLabTestId) },
        tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        testName: true,
        configSnapshot: true,
        isBillOnlyTest: true,
        samplePriorityType: true,
        scheduleDays: true,
        scheduleFrom: true,
        scheduleTo: true,
        tatMinValue: true,
        tatMinUnit: true,
        tatMaxValue: true,
        tatMaxUnit: true,
      },
    });
    const testById = new Map(tests.map((t) => [t.id, t]));

    // Preserve the panel's own member ordering (the join above has no guaranteed
    // order), skipping any member whose branch test no longer exists.
    const members: BranchLabPanelMemberTest[] = [];
    for (const j of junctions) {
      const t = testById.get(j.branchLabTestId);
      if (!t) continue;
      // Mirror branch-lab-test findOptions: the first configured sample carries
      // the sample name/type + fasting flag shown in the table.
      const sample = (
        t.configSnapshot as unknown as BranchLabTestConfigSnapshot
      )?.samples?.[0];
      members.push({
        branchLabTestId: t.id,
        name: t.testName,
        sampleName: sample?.sampleName ?? null,
        sampleType: sample?.sampleType ?? null,
        isFasting: sample?.isFastingRequired ?? false,
        samplePriorityType: t.samplePriorityType,
        scheduleDays: t.scheduleDays,
        scheduleFrom: t.scheduleFrom,
        scheduleTo: t.scheduleTo,
        tatMinValue: t.tatMinValue,
        tatMinUnit: t.tatMinUnit,
        tatMaxValue: t.tatMaxValue,
        tatMaxUnit: t.tatMaxUnit,
        isRemovable: j.isRemovable,
        isBillOnlyTest: t.isBillOnlyTest,
      });
    }

    return {
      panelId: panel.id,
      isAllowPartialBilling: panel.isAllowPartialBilling,
      maxTestsRemovable: panel.maxTestsRemovable,
      members,
    };
  }

  /**
   * Fetch one branch lab panel composed with its included branch-test rows.
   * @throws BranchLabPanelNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabPanelWithTests> {
    const panel = await this.prisma.branchLabPanel.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!panel) {
      throw new BranchLabPanelNotFoundException(id);
    }
    const tests = await this.prisma.branchLabPanelTest.findMany({
      where: { branchLabPanelId: id, tenantId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return { ...panel, tests };
  }

  /**
   * Edit a branch lab panel's branch-tunable fields. Identity and member-test
   * composition are not editable here (managed via re-import/sync). Validates
   * price ordering before writing.
   * @throws BranchLabPanelNotFoundException if missing
   * @throws ValidationException if merged prices violate min ≤ max ≤ msrp
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: UpdateBranchLabPanelDto,
  ): Promise<BranchLabPanelWithTests> {
    const current = await this.findById(id, tenantId, branchId);
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? current.priceMsrp,
      priceMaximum: dto.priceMaximum ?? current.priceMaximum,
      priceMinimum: dto.priceMinimum ?? current.priceMinimum,
    });
    await this.prisma.branchLabPanel.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
    });
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Bulk-edit branch lab panels: apply per-row branch-tunable changes to the
   * selected ids (all scoped to the caller's tenant + active branch). All
   * existence/invariant checks run before the transaction opens, so if any item
   * is invalid or its `id` can't be resolved, nothing changes.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto the array of per-row edits
   * @returns the number of branch lab panels updated
   * @throws ValidationException on duplicate ids, an empty item, or a broken price ordering
   * @throws BranchLabPanelNotFoundException if an `id` doesn't resolve to an active row
   */
  async bulkUpdate(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: BulkEditBranchLabPanelsDto,
  ): Promise<BranchLabPanelBulkEditResult> {
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

    const rows = await this.prisma.branchLabPanel.findMany({
      where: { id: { in: ids }, tenantId, branchId, deletedAt: null },
    });
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const missing = ids.find((id) => !rowById.has(id));
    if (missing) {
      throw new BranchLabPanelNotFoundException(missing);
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
        await tx.branchLabPanel.update({
          where: { id },
          data: { ...data, updatedBy: actorId },
        });
      }
    });
    return { updated: edits.length };
  }

  /**
   * Enable/disable a branch lab panel in the branch's Lab Panel List.
   * @throws BranchLabPanelNotFoundException if missing
   */
  async setActive(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    isActive: boolean,
  ): Promise<BranchLabPanel> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.branchLabPanel.update({
      where: { id },
      data: { isActive, updatedBy: actorId },
    });
  }

  /**
   * Duplicate a branch lab panel into an independent variant in the same group
   * (same `sourceLabPanelId`). The copy is a non-default duplicate (untouched by
   * sync); its `panelName` is suffixed " (Copy)". Member join rows are copied,
   * still referencing the same branch-test copies. One transaction.
   * @throws BranchLabPanelNotFoundException if the source panel is missing
   */
  async duplicate(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchLabPanelWithTests> {
    const panel = await this.findById(id, tenantId, branchId);
    const newId = await this.prisma.withTenant(tenantId, async (tx) => {
      const created = await tx.branchLabPanel.create({
        data: this.buildPanelDuplicateData(panel, actorId),
      });
      if (panel.tests.length) {
        await tx.branchLabPanelTest.createMany({
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
   * Mark a branch lab panel as its variant group's default (for order creation).
   * Clears `isDefault` on the group's other active rows first, then sets this one.
   * @throws BranchLabPanelNotFoundException if missing
   */
  async setDefault(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchLabPanel> {
    const panel = await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (panel.sourceLabPanelId) {
        await tx.branchLabPanel.updateMany({
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
      return tx.branchLabPanel.update({
        where: { id },
        data: { isDefault: true, updatedBy: actorId },
      });
    });
  }

  /**
   * Soft-delete a branch lab panel (and its member join rows). If it was the
   * group's default and active siblings remain, one is promoted to default.
   * @throws BranchLabPanelNotFoundException if missing
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchLabPanel> {
    const panel = await this.findById(id, tenantId, branchId);
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.branchLabPanelTest.updateMany({
        where: { branchLabPanelId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      const deleted = await tx.branchLabPanel.update({
        where: { id },
        data: { deletedAt: now },
      });
      if (panel.isDefault && panel.sourceLabPanelId) {
        const sibling = await tx.branchLabPanel.findFirst({
          where: {
            tenantId,
            branchId,
            sourceLabPanelId: panel.sourceLabPanelId,
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (sibling) {
          await tx.branchLabPanel.update({
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
   * Map of existing active branch-test copies in the given test list, keyed by
   * their source lab test id (so panel members reuse the Walk-in test copies).
   */
  private async loadBranchTestMap(
    tenantId: string,
    branchId: string,
    testListId: string,
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.branchLabTest.findMany({
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
   * whose branch-test copy doesn't yet exist for creation (composed here, outside
   * the tx). Members whose source test is missing are dropped (no join created).
   */
  private async planMembers(
    masterDataId: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    panel: LabPanelWithTests,
    branchTestBySource: Map<string, string>,
    newTests: Map<string, Prisma.BranchLabTestUncheckedCreateInput>,
    testList: ListPricingConfig & { id: string },
  ): Promise<MemberPlan[]> {
    const members: MemberPlan[] = [];
    for (const t of panel.tests) {
      members.push({
        sourceTestId: t.labTestId,
        sortOrder: t.sortOrder,
        isRemovable: t.isRemovable,
      });
      if (branchTestBySource.has(t.labTestId) || newTests.has(t.labTestId)) {
        continue;
      }
      try {
        const srcTest = await this.labTestService.findById(
          masterDataId,
          t.labTestId,
          tenantId,
        );
        newTests.set(
          t.labTestId,
          this.branchLabTestService.buildImportData(srcTest, {
            tenantId,
            branchId,
            sourceMasterDataId: masterDataId,
            listId: testList.id,
            list: testList,
            actorId,
          }),
        );
      } catch (e) {
        if (!(e instanceof LabTestNotFoundException)) {
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
    newTests: Map<string, Prisma.BranchLabTestUncheckedCreateInput>,
    branchTestBySource: Map<string, string>,
  ): Promise<void> {
    for (const [sourceTestId, data] of newTests) {
      const created = await tx.branchLabTest.create({ data });
      branchTestBySource.set(sourceTestId, created.id);
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
        const branchLabTestId = branchTestBySource.get(m.sourceTestId);
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
      await tx.branchLabPanelTest.createMany({ data });
    }
  }

  /** Build the create payload for a branch lab panel from a composed source panel. */
  private buildPanelImportData(
    source: LabPanelWithTests,
    target: {
      tenantId: string;
      branchId: string;
      sourceMasterDataId: string;
      listId: string;
      /** The target list's pricing config — drives the copied panel's `listPrice`. */
      list: ListPricingConfig;
      actorId: string | null;
    },
  ): Prisma.BranchLabPanelUncheckedCreateInput {
    const scalars = this.extractScalars(source);
    return {
      ...scalars,
      tenantId: target.tenantId,
      branchId: target.branchId,
      sourceLabPanelId: source.id,
      sourceMasterDataId: target.sourceMasterDataId,
      listId: target.listId,
      // List price honours the target list's pricing config: MSRP for the
      // default Walk-in list, the source column × % for a PERCENTAGE list, or
      // the source column copied as-is for a CUSTOMIZED list.
      listPrice: resolveImportListPrice(
        scalars as unknown as SourcePriceColumns,
        target.list,
      ),
      createdBy: target.actorId,
      updatedBy: target.actorId,
    } as Prisma.BranchLabPanelUncheckedCreateInput;
  }

  /**
   * Resolve the branch's default (Walk-in) panel list id for an unscoped read.
   * Returns a non-matching sentinel when the branch has never imported.
   */
  private async resolveListId(
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const list = await this.prisma.branchLabPanelList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    return list?.id ?? '__no_list__';
  }

  /**
   * Build the create payload for a duplicate from an existing branch panel row:
   * copy all fields except the re-derived ones + the composed `tests`, keep the
   * same variant group, mark it a non-default duplicate with a " (Copy)" name.
   */
  private buildPanelDuplicateData(
    panel: BranchLabPanelWithTests,
    actorId: string | null,
  ): Prisma.BranchLabPanelUncheckedCreateInput {
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
    } as Prisma.BranchLabPanelUncheckedCreateInput;
  }

  /**
   * Build the overwrite (re-snapshot) update payload from a composed source panel.
   * Reference scalars are always refreshed from Master Data; `listPrice` follows the
   * target list's pricing config: recomputed to MSRP for the default Walk-in list,
   * recomputed from the fresh source column × stored percentage for a PERCENTAGE
   * list, and **omitted** for a CUSTOMIZED (non-default) list so its manually-set
   * price is preserved untouched.
   */
  private buildPanelSyncData(
    source: LabPanelWithTests,
    actorId: string | null,
    list: ListPricingConfig,
  ): Prisma.BranchLabPanelUncheckedUpdateInput {
    const scalars = this.extractScalars(source);
    const listPrice = resolveSyncListPrice(
      scalars as unknown as SourcePriceColumns,
      list,
    );
    return {
      ...scalars,
      updatedBy: actorId,
      // null = CUSTOMIZED list: leave `listPrice` out of the update to preserve it.
      ...(listPrice !== null ? { listPrice } : {}),
    };
  }

  /** Drop re-derived/scope keys and the read-only refs/tests from a composed panel. */
  private extractScalars(source: LabPanelWithTests): Record<string, unknown> {
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
    changes: Omit<BulkEditBranchLabPanelsDto['data'][number], 'id'>,
  ): Prisma.BranchLabPanelUncheckedUpdateInput {
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
      throw new BranchLabPanelDefaultConflictException();
    }
  }
}
