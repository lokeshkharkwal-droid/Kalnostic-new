import { Injectable } from '@nestjs/common';
import { BranchLabPanel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { LabPanelService } from '../lab-panel/lab-panel.service';
import { LabTestService } from '../lab-test/lab-test.service';
import { LabPanelWithTests } from '../lab-panel/entities/lab-panel.entity';
import { LabPanelNotFoundException } from '../lab-panel/exceptions/lab-panel.exceptions';
import { LabTestNotFoundException } from '../lab-test/exceptions/lab-test.exceptions';
import { BranchLabTestService } from '../branch-lab-test/branch-lab-test.service';
import { BranchLabTestListService } from '../branch-lab-test-list/branch-lab-test-list.service';
import { BranchLabPanelListService } from '../branch-lab-panel-list/branch-lab-panel-list.service';
import { ImportBranchLabPanelsDto } from './dto/import-branch-lab-panels.dto';
import { SyncBranchLabPanelsDto } from './dto/sync-branch-lab-panels.dto';
import { ListBranchLabPanelsQueryDto } from './dto/list-branch-lab-panels-query.dto';
import { UpdateBranchLabPanelDto } from './dto/update-branch-lab-panel.dto';
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

/** A Create-Order lab-panel option row (Diagnostic Items table). */
export interface BranchLabPanelOption {
  id: string;
  name: string;
  price: number;
  sampleType: string | null;
  isFasting: boolean;
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
   * @param dto the source lab-panel ids to import
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
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
    // Import lands in the branch's default (Walk-in) panel list; member tests are
    // materialized into the default (Walk-in) test list (Phase 1).
    const walkInPanel = await this.panelListService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const walkInTest = await this.testListService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const validPanels = await this.prisma.labPanel.findMany({
      where: {
        id: { in: dto.labPanelIds },
        masterDataId: masterData.id,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const validIds = validPanels.map((p) => p.id);
    // Existing Walk-in panels for these sources are UPDATED (re-snapshot + rebuild
    // members); new ones are ADDED — never duplicated (Phase 1).
    const existing = await this.prisma.branchLabPanel.findMany({
      where: {
        tenantId,
        branchId,
        listId: walkInPanel.id,
        deletedAt: null,
        sourceLabPanelId: { in: validIds },
      },
      select: { id: true, sourceLabPanelId: true },
    });
    const existingBySource = new Map(
      existing.map((p) => [p.sourceLabPanelId, p.id] as const),
    );

    const branchTestBySource = await this.loadBranchTestMap(
      tenantId,
      branchId,
      walkInTest.id,
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
    const skipped = dto.labPanelIds.length - validIds.length;

    for (const id of validIds) {
      const panel = await this.labPanelService.findById(
        masterData.id,
        id,
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
            sourceMasterDataId: masterData.id,
            listId: walkInPanel.id,
            actorId,
          }),
          members,
        });
      }
    }

    if (!panelsToCreate.length && !panelsToUpdate.length) {
      return { copied: 0, updated: 0, skipped };
    }
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
    return {
      copied: panelsToCreate.length,
      updated: panelsToUpdate.length,
      skipped,
    };
  }

  /**
   * Re-snapshot branch lab panels from their source Master Data panels. Reloads
   * each copy's source (via `sourceLabPanelId`), OVERWRITES the copy's fields, and
   * rebuilds its member tests from the source composition (materializing any
   * missing member-test copies). Copies whose source is gone are skipped.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto optional subset of branch-lab-panel ids to sync (omit = all)
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   */
  async syncFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: SyncBranchLabPanelsDto,
  ): Promise<BranchLabPanelSyncResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    // Sync only refreshes the default (Walk-in) panel list — the one connected to
    // Master Data. Non-default lists are managed independently.
    const walkInPanel = await this.panelListService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const walkInTest = await this.testListService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    const where: Prisma.BranchLabPanelWhereInput = {
      tenantId,
      branchId,
      listId: walkInPanel.id,
      deletedAt: null,
      // Only imported originals are re-snapshotted; user duplicates keep their edits.
      isDuplicate: false,
      sourceLabPanelId: { not: null },
    };
    if (dto.branchLabPanelIds?.length) {
      where.id = { in: dto.branchLabPanelIds };
    }
    const copies = await this.prisma.branchLabPanel.findMany({
      where,
      select: { id: true, sourceLabPanelId: true },
    });

    const branchTestBySource = await this.loadBranchTestMap(
      tenantId,
      branchId,
      walkInTest.id,
    );
    const newTests = new Map<
      string,
      Prisma.BranchLabTestUncheckedCreateInput
    >();
    const plans: {
      id: string;
      data: Prisma.BranchLabPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[] = [];
    let skipped = 0;

    for (const copy of copies) {
      if (!copy.sourceLabPanelId) {
        skipped += 1;
        continue;
      }
      try {
        const panel = await this.labPanelService.findById(
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
        if (e instanceof LabPanelNotFoundException) {
          skipped += 1;
          continue;
        }
        throw e;
      }
    }

    if (plans.length) {
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          await this.persistNewTests(tx, newTests, branchTestBySource);
          for (const plan of plans) {
            await tx.branchLabPanel.update({
              where: { id: plan.id },
              data: plan.data,
            });
            // Rebuild membership: retire existing active joins, then re-create.
            await tx.branchLabPanelTest.updateMany({
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
        });
      } catch (e) {
        this.rethrowConflict(e);
        throw e;
      }
    }
    return { synced: plans.length, skipped };
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
    const sampleSummaries = await this.resolveSampleSummaries(
      data.map((p) => p.id),
    );
    const enriched: BranchLabPanelListRow[] = data.map((p) => ({
      ...p,
      sampleSummary: sampleSummaries.get(p.id) ?? null,
    }));
    return { data: enriched, total, page, limit };
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
        (t.configSnapshot as unknown as BranchLabTestConfigSnapshot)
          ?.samples ?? [];
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
    }

    const select = {
      id: true,
      panelName: true,
      listPrice: true,
      isFastingRequired: true,
    } as const;
    const orderBy = { panelName: 'asc' } as const;
    const toOption = (r: {
      id: string;
      panelName: string;
      listPrice: number;
      isFastingRequired: boolean;
    }): BranchLabPanelOption => ({
      id: r.id,
      name: r.panelName,
      price: r.listPrice,
      sampleType: null,
      isFasting: r.isFastingRequired,
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
    testListId: string,
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
            listId: testListId,
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
      // Walk-in default list: the sellable list price starts at MSRP.
      listPrice: (scalars.priceMsrp as number) ?? 0,
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

  /** Build the overwrite (re-snapshot) update payload from a composed source panel. */
  private buildPanelSyncData(
    source: LabPanelWithTests,
    actorId: string | null,
  ): Prisma.BranchLabPanelUncheckedUpdateInput {
    const scalars = this.extractScalars(source);
    return {
      ...scalars,
      // Walk-in list price tracks MSRP on re-snapshot (agreed overwrite contract).
      listPrice: (scalars.priceMsrp as number) ?? 0,
      updatedBy: actorId,
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
