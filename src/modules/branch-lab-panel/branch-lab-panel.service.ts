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
  BranchLabPanelSyncResult,
  BranchLabPanelWithTests,
} from './entities/branch-lab-panel.entity';

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
    const existing = await this.prisma.branchLabPanel.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        sourceLabPanelId: { in: validIds },
      },
      select: { sourceLabPanelId: true },
    });
    const importedSources = new Set(existing.map((p) => p.sourceLabPanelId));

    const branchTestBySource = await this.loadBranchTestMap(tenantId, branchId);
    const newTests = new Map<
      string,
      Prisma.BranchLabTestUncheckedCreateInput
    >();
    const panelsToCreate: {
      data: Prisma.BranchLabPanelUncheckedCreateInput;
      members: MemberPlan[];
    }[] = [];
    let skipped = dto.labPanelIds.length - validIds.length;

    for (const id of validIds) {
      if (importedSources.has(id)) {
        skipped += 1;
        continue;
      }
      importedSources.add(id);
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
      );
      panelsToCreate.push({
        data: this.buildPanelImportData(panel, {
          tenantId,
          branchId,
          sourceMasterDataId: masterData.id,
          actorId,
        }),
        members,
      });
    }

    if (!panelsToCreate.length) {
      return { copied: 0, skipped };
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
      });
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
    return { copied: panelsToCreate.length, skipped };
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
    const where: Prisma.BranchLabPanelWhereInput = {
      tenantId,
      branchId,
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

    const branchTestBySource = await this.loadBranchTestMap(tenantId, branchId);
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
  ): Promise<PaginatedResult<BranchLabPanel>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.BranchLabPanelWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };
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
    return { data, total, page, limit };
  }

  /**
   * Lightweight `{ id, name }` options for the Create-Order lab-panel selector.
   * Returns the branch's **active default-variant** rows only (one orderable row
   * per variant group), so a selected id is directly usable as an order item's
   * `branchLabPanelId`. Supports a case-insensitive `search` on panelName.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param filters optional search + offset pagination
   * @returns full `{ id, name }[]` when `page` is omitted, else a paginated envelope
   */
  async findOptions(
    tenantId: string,
    branchId: string,
    filters: { search?: string; page?: number; limit?: number } = {},
  ): Promise<
    | Array<{ id: string; name: string }>
    | PaginatedResult<{ id: string; name: string }>
  > {
    const where: Prisma.BranchLabPanelWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
      isActive: true,
      isDefault: true,
    };
    const term = filters.search?.trim();
    if (term) {
      where.panelName = { contains: term, mode: 'insensitive' };
    }

    const select = { id: true, panelName: true } as const;
    const orderBy = { panelName: 'asc' } as const;
    const toOption = (r: { id: string; panelName: string }) => ({
      id: r.id,
      name: r.panelName,
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

  /** Map of existing active branch-test copies keyed by their source lab test id. */
  private async loadBranchTestMap(
    tenantId: string,
    branchId: string,
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.branchLabTest.findMany({
      where: {
        tenantId,
        branchId,
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
      actorId: string | null;
    },
  ): Prisma.BranchLabPanelUncheckedCreateInput {
    return {
      ...this.extractScalars(source),
      tenantId: target.tenantId,
      branchId: target.branchId,
      sourceLabPanelId: source.id,
      sourceMasterDataId: target.sourceMasterDataId,
      createdBy: target.actorId,
      updatedBy: target.actorId,
    } as Prisma.BranchLabPanelUncheckedCreateInput;
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
    return {
      ...this.extractScalars(source),
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
