import { Injectable } from '@nestjs/common';
import {
  BranchRadiologyPanel,
  Prisma,
  RadiologyPanel,
  TatUnit,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { BranchRadiologyPanelListService } from '../branch-radiology-panel-list/branch-radiology-panel-list.service';
import { ImportBranchRadiologyPanelsDto } from './dto/import-branch-radiology-panels.dto';
import { SyncBranchRadiologyPanelsDto } from './dto/sync-branch-radiology-panels.dto';
import { ListBranchRadiologyPanelsQueryDto } from './dto/list-branch-radiology-panels-query.dto';
import { UpdateBranchRadiologyPanelDto } from './dto/update-branch-radiology-panel.dto';
import {
  BranchRadiologyPanelDefaultConflictException,
  BranchRadiologyPanelNotFoundException,
} from './exceptions/branch-radiology-panel.exceptions';
import {
  BranchRadiologyPanelImportResult,
  BranchRadiologyPanelListRow,
  BranchRadiologyPanelSyncResult,
  BranchRadiologyPanelWithTests,
} from './entities/branch-radiology-panel.entity';

/** A Create-Order radiology-panel option row (Diagnostic Items table). */
export interface BranchRadiologyPanelOption {
  id: string;
  name: string;
  price: number;
  /**
   * Whether discounts may be applied to this panel — derived from the inverted
   * `isDisableDiscount` so the Create-Order discount input reads one uniform flag
   * for both tests and panels.
   */
  isAllowDiscounts: boolean;
  /** Billed-only panel: excluded from the imaging workflow (no report). */
  isBillOnlyTest: boolean;
  tatMinValue: number | null;
  tatMinUnit: TatUnit | null;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
}

/** A resolved panel member: the source test id + its ordering/removable/discount. */
interface MemberPlan {
  sourceTestId: string;
  sortOrder: number;
  isRemovable: boolean;
  discountPercent: number | null;
}

/**
 * A branch's operational **Radiology Panel List** — materialized, independent
 * snapshots of the branch's Master Data radiology panels. Tenant-scoped +
 * branch-level; tenant/branch come from the JWT (never the body). A panel's member
 * tests are rebuilt against the branch's own `BranchRadiologyTest` copies (matched
 * by `sourceRadiologyTestId` in the branch's Walk-in test list); members with no
 * branch copy are skipped (the branch test must be imported first). Sync overwrites
 * a copy from its source and rebuilds its member composition. Source rows are
 * composed BEFORE opening a `withTenant` tx. Mirrors `BranchLabPanelService` for
 * the (flat-test) radiology model; bulk-edit is intentionally dropped.
 */
@Injectable()
export class BranchRadiologyPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: MasterDataService,
    private readonly panelListService: BranchRadiologyPanelListService,
  ) {}

  /**
   * Persist-import the selected Master Data radiology panels into the active
   * branch's Radiology Panel List. Each panel is deep-copied as the group's
   * imported original (`isDefault=true`, `isDuplicate=false`); its member tests are
   * mapped to the branch's existing `BranchRadiologyTest` copies (matched by
   * `sourceRadiologyTestId`) — members with no branch copy are skipped. Idempotent:
   * a panel whose variant group already has an active row (matched by
   * `sourceRadiologyPanelId`) is re-snapshotted, not duplicated; ids not in the
   * branch's master data are skipped.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the source radiology-panel ids to import, plus an optional target `listId`
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   * @throws BranchRadiologyPanelListNotFoundException if `dto.listId` doesn't belong to this branch
   */
  async importFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: ImportBranchRadiologyPanelsDto,
  ): Promise<BranchRadiologyPanelImportResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    const targetPanelList = await this.resolveTargetList(
      tenantId,
      branchId,
      actorId,
      dto.listId,
    );
    const branchTestBySource = await this.loadBranchTestMap(tenantId, branchId);
    const plan = await this.buildImportPlan(
      masterData.id,
      tenantId,
      branchId,
      targetPanelList.id,
      actorId,
      dto.radiologyPanelIds,
    );
    await this.writeImportPlan(
      tenantId,
      plan.panelsToCreate,
      plan.panelsToUpdate,
      branchTestBySource,
    );
    return {
      copied: plan.panelsToCreate.length,
      updated: plan.panelsToUpdate.length,
      skipped: plan.skipped,
    };
  }

  /**
   * Import every Master Data radiology panel matching the given search/
   * classification filters (server-resolved — no client-supplied id list) into the
   * active branch's Radiology Panel List. Mirrors {@link importFromMasterData}'s
   * create/update/member-mapping semantics exactly; writes commit in fixed-size
   * batches (not one transaction) so a "select all" spanning thousands of panels
   * can't become a single all-or-nothing write.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param dto the search/classification filters plus an optional target `listId`
   * @returns counts of copied vs updated panels (no "skipped")
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   * @throws BranchRadiologyPanelListNotFoundException if `dto.listId` doesn't belong to this branch
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
  ): Promise<BranchRadiologyPanelImportResult> {
    const masterData = await this.masterDataService.findByBranch(
      branchId,
      tenantId,
    );
    const targetPanelList = await this.resolveTargetList(
      tenantId,
      branchId,
      actorId,
      dto.listId,
    );
    const where = await this.buildImportableWhere(
      masterData.id,
      tenantId,
      dto.search,
      { department: dto.department, category: dto.category },
      targetPanelList.id,
    );
    const matches = await this.prisma.radiologyPanel.findMany({
      where,
      select: { id: true },
    });
    const ids = matches.map((m) => m.id);

    const branchTestBySource = await this.loadBranchTestMap(tenantId, branchId);

    let copied = 0;
    let updated = 0;
    const WRITE_BATCH_SIZE = 25;
    for (let i = 0; i < ids.length; i += WRITE_BATCH_SIZE) {
      const batchIds = ids.slice(i, i + WRITE_BATCH_SIZE);
      const plan = await this.buildImportPlan(
        masterData.id,
        tenantId,
        branchId,
        targetPanelList.id,
        actorId,
        batchIds,
      );
      await this.writeImportPlan(
        tenantId,
        plan.panelsToCreate,
        plan.panelsToUpdate,
        branchTestBySource,
      );
      copied += plan.panelsToCreate.length;
      updated += plan.panelsToUpdate.length;
    }
    return { copied, updated, skipped: 0 };
  }

  /**
   * Build the `where` for the importable Master Data radiology panels — matching
   * the import-picker's "Available to Add" listing. Excludes sources already
   * copied into the target list (by `sourceRadiologyPanelId`). RadiologyPanel's
   * classification refs are logical (no Prisma relation), so the department/
   * category name filters resolve the matching catalogue ids first.
   */
  private async buildImportableWhere(
    masterDataId: string,
    tenantId: string,
    search: string | undefined,
    classificationFilters: { department?: string; category?: string },
    excludeListId?: string,
  ): Promise<Prisma.RadiologyPanelWhereInput> {
    const where: Prisma.RadiologyPanelWhereInput = {
      masterDataId,
      tenantId,
      deletedAt: null,
    };
    if (excludeListId) {
      const existing = await this.prisma.branchRadiologyPanel.findMany({
        where: {
          tenantId,
          listId: excludeListId,
          deletedAt: null,
          sourceRadiologyPanelId: { not: null },
        },
        select: { sourceRadiologyPanelId: true },
      });
      const existingIds = existing
        .map((r) => r.sourceRadiologyPanelId)
        .filter((x): x is string => Boolean(x));
      if (existingIds.length > 0) {
        where.id = { notIn: existingIds };
      }
    }
    const term = search?.trim();
    if (term) {
      where.OR = [
        { panelName: { contains: term, mode: 'insensitive' } },
        { panelCode: { contains: term, mode: 'insensitive' } },
      ];
    }
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
    return where;
  }

  /** Resolve the active catalogue-row ids whose name contains `term` (tenant-scoped). */
  private async classificationIdsByName(
    model: 'department' | 'category',
    tenantId: string,
    term: string,
  ): Promise<string[]> {
    const where = {
      tenantId,
      name: { contains: term, mode: 'insensitive' as const },
    };
    const select = { id: true };
    const rows =
      model === 'department'
        ? await this.prisma.department.findMany({ where, select })
        : await this.prisma.category.findMany({ where, select });
    return rows.map((r) => r.id);
  }

  /**
   * Resolve the panel list an import/sync should target: the default (Walk-in)
   * panel list is always ensured to exist first, then the given `listId` is used
   * if present (validated to belong to this branch) or the just-ensured default
   * otherwise.
   */
  private async resolveTargetList(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    listId?: string,
  ) {
    const defaultList = await this.panelListService.getOrCreateDefaultList(
      tenantId,
      branchId,
      actorId,
    );
    return listId
      ? await this.panelListService.findById(listId, tenantId, branchId)
      : defaultList;
  }

  /**
   * Resolve a set of Master Data radiology-panel ids into create/update plans for
   * the target list (mirrors {@link BranchLabPanelService}'s `buildPanelImportPlan`):
   * a source already copied into it (matched by `sourceRadiologyPanelId`) is
   * re-snapshotted (UPDATE); a new one is materialized (CREATE). Each plan carries
   * its source members resolved to `MemberPlan`s (the branch-test copies are
   * resolved later, inside the write transaction).
   */
  private async buildImportPlan(
    masterDataId: string,
    tenantId: string,
    branchId: string,
    targetPanelListId: string,
    actorId: string | null,
    candidateIds: string[],
  ): Promise<{
    panelsToCreate: {
      data: Prisma.BranchRadiologyPanelUncheckedCreateInput;
      members: MemberPlan[];
    }[];
    panelsToUpdate: {
      id: string;
      data: Prisma.BranchRadiologyPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[];
    skipped: number;
  }> {
    const validPanels = await this.prisma.radiologyPanel.findMany({
      where: {
        id: { in: candidateIds },
        masterDataId,
        tenantId,
        deletedAt: null,
      },
    });
    const validById = new Map(validPanels.map((p) => [p.id, p]));
    const validIds = validPanels.map((p) => p.id);
    const existing = await this.prisma.branchRadiologyPanel.findMany({
      where: {
        tenantId,
        branchId,
        listId: targetPanelListId,
        deletedAt: null,
        sourceRadiologyPanelId: { in: validIds },
      },
      select: { id: true, sourceRadiologyPanelId: true },
    });
    const existingBySource = new Map(
      existing.map((p) => [p.sourceRadiologyPanelId, p.id] as const),
    );

    const panelsToCreate: {
      data: Prisma.BranchRadiologyPanelUncheckedCreateInput;
      members: MemberPlan[];
    }[] = [];
    const panelsToUpdate: {
      id: string;
      data: Prisma.BranchRadiologyPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[] = [];
    const skipped = candidateIds.length - validIds.length;

    for (const id of validIds) {
      const panel = validById.get(id)!;
      const members = await this.planMembers(panel.id, tenantId);
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
    return { panelsToCreate, panelsToUpdate, skipped };
  }

  /** Apply a resolved panel create/update plan in one transaction. */
  private async writeImportPlan(
    tenantId: string,
    panelsToCreate: {
      data: Prisma.BranchRadiologyPanelUncheckedCreateInput;
      members: MemberPlan[];
    }[],
    panelsToUpdate: {
      id: string;
      data: Prisma.BranchRadiologyPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[],
    branchTestBySource: Map<string, string>,
  ): Promise<void> {
    if (!panelsToCreate.length && !panelsToUpdate.length) return;
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        for (const p of panelsToCreate) {
          const panel = await tx.branchRadiologyPanel.create({ data: p.data });
          await this.createJoins(
            tx,
            tenantId,
            panel.tenantId,
            panel.branchId,
            panel.id,
            p.members,
            branchTestBySource,
          );
        }
        for (const p of panelsToUpdate) {
          const panel = await tx.branchRadiologyPanel.update({
            where: { id: p.id },
            data: p.data,
          });
          await tx.branchRadiologyPanelTest.updateMany({
            where: {
              branchRadiologyPanelId: p.id,
              tenantId,
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          });
          await this.createJoins(
            tx,
            tenantId,
            panel.tenantId,
            panel.branchId,
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
   * Re-snapshot branch radiology panels from their source Master Data panels.
   * Reloads each copy's source (via `sourceRadiologyPanelId`), OVERWRITES the
   * copy's fields, and rebuilds its member tests from the source composition
   * (mapping to the branch's existing `BranchRadiologyTest` copies). Copies whose
   * source is gone are soft-deleted (and a sibling promoted to default if needed).
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as updated-by (or null)
   * @param dto optional subset of branch-radiology-panel ids to sync (omit = all)
   *   and an optional target `listId` (omit = the default Walk-in panel list)
   * @throws MasterDataNotMappedToBranchException if the branch has no master data
   * @throws BranchRadiologyPanelListNotFoundException if `dto.listId` doesn't belong to this branch
   */
  async syncFromMasterData(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: SyncBranchRadiologyPanelsDto,
  ): Promise<BranchRadiologyPanelSyncResult> {
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
    const where: Prisma.BranchRadiologyPanelWhereInput = {
      tenantId,
      branchId,
      listId: targetPanelList.id,
      deletedAt: null,
      // Only imported originals are re-snapshotted; user duplicates keep their edits.
      isDuplicate: false,
      sourceRadiologyPanelId: { not: null },
    };
    if (dto.branchRadiologyPanelIds?.length) {
      where.id = { in: dto.branchRadiologyPanelIds };
    }
    const copies = await this.prisma.branchRadiologyPanel.findMany({
      where,
      select: {
        id: true,
        sourceRadiologyPanelId: true,
        isDefault: true,
        tenantId: true,
        branchId: true,
      },
    });

    const branchTestBySource = await this.loadBranchTestMap(tenantId, branchId);
    const plans: {
      id: string;
      tenantId: string;
      branchId: string;
      data: Prisma.BranchRadiologyPanelUncheckedUpdateInput;
      members: MemberPlan[];
    }[] = [];
    const toDelete: {
      id: string;
      isDefault: boolean;
      sourceRadiologyPanelId: string | null;
    }[] = [];
    let skipped = 0;

    for (const copy of copies) {
      if (!copy.sourceRadiologyPanelId) {
        skipped += 1;
        continue;
      }
      const source = await this.prisma.radiologyPanel.findFirst({
        where: {
          id: copy.sourceRadiologyPanelId,
          masterDataId: masterData.id,
          tenantId,
          deletedAt: null,
        },
      });
      if (!source) {
        // Source has been soft-deleted at Master Data — the branch's copy is
        // stale and no longer orderable, so it is removed rather than skipped.
        toDelete.push(copy);
        continue;
      }
      const members = await this.planMembers(source.id, tenantId);
      plans.push({
        id: copy.id,
        tenantId: copy.tenantId,
        branchId: copy.branchId,
        data: this.buildPanelSyncData(source, actorId),
        members,
      });
    }

    if (plans.length || toDelete.length) {
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          for (const plan of plans) {
            await tx.branchRadiologyPanel.update({
              where: { id: plan.id },
              data: plan.data,
            });
            // Rebuild membership: retire existing active joins, then re-create.
            await tx.branchRadiologyPanelTest.updateMany({
              where: {
                branchRadiologyPanelId: plan.id,
                tenantId,
                deletedAt: null,
              },
              data: { deletedAt: new Date() },
            });
            await this.createJoins(
              tx,
              tenantId,
              plan.tenantId,
              plan.branchId,
              plan.id,
              plan.members,
              branchTestBySource,
            );
          }
          for (const d of toDelete) {
            const now = new Date();
            await tx.branchRadiologyPanelTest.updateMany({
              where: {
                branchRadiologyPanelId: d.id,
                tenantId,
                deletedAt: null,
              },
              data: { deletedAt: now },
            });
            await tx.branchRadiologyPanel.update({
              where: { id: d.id },
              data: { deletedAt: now },
            });
            if (d.isDefault && d.sourceRadiologyPanelId) {
              const sibling = await tx.branchRadiologyPanel.findFirst({
                where: {
                  tenantId,
                  branchId,
                  sourceRadiologyPanelId: d.sourceRadiologyPanelId,
                  deletedAt: null,
                },
                orderBy: { createdAt: 'asc' },
              });
              if (sibling) {
                await tx.branchRadiologyPanel.update({
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
   * List the branch's Radiology Panel List (paginated + search + status).
   * @param tenantId tenant scope
   * @param branchId active branch
   * @param query pagination + filters
   */
  async findAll(
    tenantId: string,
    branchId: string,
    query: ListBranchRadiologyPanelsQueryDto,
  ): Promise<PaginatedResult<BranchRadiologyPanelListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.BranchRadiologyPanelWhereInput = {
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
      this.prisma.branchRadiologyPanel.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { panelName: 'asc' },
      }),
      this.prisma.branchRadiologyPanel.count({ where }),
    ]);
    const [deptNames, catNames] = await Promise.all([
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
    const enriched: BranchRadiologyPanelListRow[] = data.map((p) => ({
      ...p,
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
   * Lightweight options for the Create-Order radiology-panel selector. Returns the
   * branch's **active default-variant** rows only (one orderable row per variant
   * group), so a selected id is directly usable as an order item's
   * `branchRadiologyPanelId`. `price` is the list price (`listPrice`, minor units).
   * Supports a case-insensitive `search` on panelName; `preferredOnly` narrows the
   * unsearched view to `isPreference: true`.
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
    | Array<BranchRadiologyPanelOption>
    | PaginatedResult<BranchRadiologyPanelOption>
  > {
    const where: Prisma.BranchRadiologyPanelWhereInput = {
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
      isDisableDiscount: boolean;
      isBillOnlyTest: boolean;
      tatMinValue: number | null;
      tatMinUnit: TatUnit | null;
      tatMaxValue: number | null;
      tatMaxUnit: TatUnit | null;
    }): BranchRadiologyPanelOption => ({
      id: r.id,
      name: r.panelName,
      price: r.listPrice,
      isAllowDiscounts: !r.isDisableDiscount,
      isBillOnlyTest: r.isBillOnlyTest,
      tatMinValue: r.tatMinValue,
      tatMinUnit: r.tatMinUnit,
      tatMaxValue: r.tatMaxValue,
      tatMaxUnit: r.tatMaxUnit,
    });

    if (filters.page === undefined) {
      const rows = await this.prisma.branchRadiologyPanel.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map(toOption);
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.branchRadiologyPanel.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.branchRadiologyPanel.count({ where }),
    ]);
    return { data: rows.map(toOption), total, page, limit };
  }

  /**
   * Fetch one branch radiology panel composed with its included branch-test rows.
   * @throws BranchRadiologyPanelNotFoundException if missing/soft-deleted/other branch
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyPanelWithTests> {
    const panel = await this.prisma.branchRadiologyPanel.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!panel) {
      throw new BranchRadiologyPanelNotFoundException(id);
    }
    const tests = await this.prisma.branchRadiologyPanelTest.findMany({
      where: { branchRadiologyPanelId: id, tenantId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return { ...panel, tests };
  }

  /**
   * Edit a branch radiology panel's branch-tunable fields. Identity and member-test
   * composition are not editable here (managed via re-import/sync). Validates
   * price ordering before writing.
   * @throws BranchRadiologyPanelNotFoundException if missing
   * @throws ValidationException if merged prices violate min ≤ max ≤ msrp
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    dto: UpdateBranchRadiologyPanelDto,
  ): Promise<BranchRadiologyPanelWithTests> {
    const current = await this.findById(id, tenantId, branchId);
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? current.priceMsrp,
      priceMaximum: dto.priceMaximum ?? current.priceMaximum,
      priceMinimum: dto.priceMinimum ?? current.priceMinimum,
    });
    await this.prisma.branchRadiologyPanel.update({
      where: { id },
      data: { ...dto, updatedBy: actorId },
    });
    return this.findById(id, tenantId, branchId);
  }

  /**
   * Enable/disable a branch radiology panel in the branch's Radiology Panel List.
   * @throws BranchRadiologyPanelNotFoundException if missing
   */
  async setActive(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    isActive: boolean,
  ): Promise<BranchRadiologyPanel> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.branchRadiologyPanel.update({
      where: { id },
      data: { isActive, updatedBy: actorId },
    });
  }

  /**
   * Duplicate a branch radiology panel into an independent variant in the same
   * group (same `sourceRadiologyPanelId`). The copy is a non-default duplicate
   * (untouched by sync); its `panelName` is suffixed " (Copy)". Member join rows
   * are copied, still referencing the same branch-test copies. One transaction.
   * @throws BranchRadiologyPanelNotFoundException if the source panel is missing
   */
  async duplicate(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchRadiologyPanelWithTests> {
    const panel = await this.findById(id, tenantId, branchId);
    const newId = await this.prisma.withTenant(tenantId, async (tx) => {
      const created = await tx.branchRadiologyPanel.create({
        data: this.buildPanelDuplicateData(panel, actorId),
      });
      if (panel.tests.length) {
        await tx.branchRadiologyPanelTest.createMany({
          data: panel.tests.map((t) => ({
            tenantId,
            branchId,
            branchRadiologyPanelId: created.id,
            branchRadiologyTestId: t.branchRadiologyTestId,
            sortOrder: t.sortOrder,
            isRemovable: t.isRemovable,
            discountPercent: t.discountPercent,
          })),
        });
      }
      return created.id;
    });
    return this.findById(newId, tenantId, branchId);
  }

  /**
   * Mark a branch radiology panel as its variant group's default (for order
   * creation). Clears `isDefault` on the group's other active rows first, then sets
   * this one.
   * @throws BranchRadiologyPanelNotFoundException if missing
   */
  async setDefault(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<BranchRadiologyPanel> {
    const panel = await this.findById(id, tenantId, branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (panel.sourceRadiologyPanelId) {
        await tx.branchRadiologyPanel.updateMany({
          where: {
            tenantId,
            branchId,
            sourceRadiologyPanelId: panel.sourceRadiologyPanelId,
            deletedAt: null,
            isDefault: true,
            id: { not: id },
          },
          data: { isDefault: false },
        });
      }
      return tx.branchRadiologyPanel.update({
        where: { id },
        data: { isDefault: true, updatedBy: actorId },
      });
    });
  }

  /**
   * Soft-delete a branch radiology panel (and its member join rows). If it was the
   * group's default and active siblings remain, one is promoted to default.
   * @throws BranchRadiologyPanelNotFoundException if missing
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchRadiologyPanel> {
    const panel = await this.findById(id, tenantId, branchId);
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.branchRadiologyPanelTest.updateMany({
        where: { branchRadiologyPanelId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      const deleted = await tx.branchRadiologyPanel.update({
        where: { id },
        data: { deletedAt: now },
      });
      if (panel.isDefault && panel.sourceRadiologyPanelId) {
        const sibling = await tx.branchRadiologyPanel.findFirst({
          where: {
            tenantId,
            branchId,
            sourceRadiologyPanelId: panel.sourceRadiologyPanelId,
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (sibling) {
          await tx.branchRadiologyPanel.update({
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
   * Map of existing active branch-test copies in the branch's default (Walk-in)
   * test list, keyed by their source radiology test id (so panel members reuse the
   * branch's `BranchRadiologyTest` copies). An empty map is returned when the
   * branch has never imported a test list.
   */
  private async loadBranchTestMap(
    tenantId: string,
    branchId: string,
  ): Promise<Map<string, string>> {
    const testList = await this.prisma.branchRadiologyTestList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    const map = new Map<string, string>();
    if (!testList) {
      return map;
    }
    const rows = await this.prisma.branchRadiologyTest.findMany({
      where: {
        tenantId,
        branchId,
        listId: testList.id,
        deletedAt: null,
        sourceRadiologyTestId: { not: null },
      },
      select: { id: true, sourceRadiologyTestId: true },
    });
    for (const r of rows) {
      if (r.sourceRadiologyTestId) {
        map.set(r.sourceRadiologyTestId, r.id);
      }
    }
    return map;
  }

  /**
   * Resolve a source panel's member tests into `MemberPlan`s (reading the source
   * `RadiologyPanelTest` rows directly). The branch-test copies are resolved later
   * inside the write tx; members with no branch copy are dropped there.
   */
  private async planMembers(
    radiologyPanelId: string,
    tenantId: string,
  ): Promise<MemberPlan[]> {
    const members = await this.prisma.radiologyPanelTest.findMany({
      where: { radiologyPanelId, tenantId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return members.map((t) => ({
      sourceTestId: t.radiologyTestId,
      sortOrder: t.sortOrder,
      isRemovable: t.isRemovable,
      discountPercent: t.discountPercent,
    }));
  }

  /**
   * Create the panel's member join rows, skipping members whose source test has no
   * `BranchRadiologyTest` copy in the branch (the branch test must be imported
   * first — mirrors branch-lab-panel's drop-on-no-copy behaviour).
   */
  private async createJoins(
    tx: Prisma.TransactionClient,
    tenantId: string,
    rowTenantId: string,
    branchId: string,
    branchRadiologyPanelId: string,
    members: MemberPlan[],
    branchTestBySource: Map<string, string>,
  ): Promise<void> {
    const data = members
      .map((m) => {
        const branchRadiologyTestId = branchTestBySource.get(m.sourceTestId);
        if (!branchRadiologyTestId) {
          return null;
        }
        return {
          tenantId: rowTenantId,
          branchId,
          branchRadiologyPanelId,
          branchRadiologyTestId,
          sortOrder: m.sortOrder,
          isRemovable: m.isRemovable,
          discountPercent: m.discountPercent,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (data.length) {
      await tx.branchRadiologyPanelTest.createMany({ data });
    }
  }

  /** Build the create payload for a branch radiology panel from a source panel. */
  private buildPanelImportData(
    source: RadiologyPanel,
    target: {
      tenantId: string;
      branchId: string;
      sourceMasterDataId: string;
      listId: string;
      actorId: string | null;
    },
  ): Prisma.BranchRadiologyPanelUncheckedCreateInput {
    const scalars = this.extractScalars(source);
    return {
      ...scalars,
      tenantId: target.tenantId,
      branchId: target.branchId,
      sourceRadiologyPanelId: source.id,
      sourceMasterDataId: target.sourceMasterDataId,
      listId: target.listId,
      // Walk-in default list: the sellable list price starts at MSRP.
      listPrice: (scalars.priceMsrp as number) ?? 0,
      createdBy: target.actorId,
      updatedBy: target.actorId,
    } as Prisma.BranchRadiologyPanelUncheckedCreateInput;
  }

  /**
   * Resolve the branch's default (Walk-in) panel list id for an unscoped read.
   * Returns a non-matching sentinel when the branch has never imported (so reads
   * are empty rather than mixing lists). Does not create the list (reads must not
   * write).
   */
  private async resolveListId(
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const list = await this.prisma.branchRadiologyPanelList.findFirst({
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
    panel: BranchRadiologyPanelWithTests,
    actorId: string | null,
  ): Prisma.BranchRadiologyPanelUncheckedCreateInput {
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
    } as Prisma.BranchRadiologyPanelUncheckedCreateInput;
  }

  /** Build the overwrite (re-snapshot) update payload from a source panel. */
  private buildPanelSyncData(
    source: RadiologyPanel,
    actorId: string | null,
  ): Prisma.BranchRadiologyPanelUncheckedUpdateInput {
    const scalars = this.extractScalars(source);
    return {
      ...scalars,
      // Walk-in list price tracks MSRP on re-snapshot (agreed overwrite contract).
      listPrice: (scalars.priceMsrp as number) ?? 0,
      updatedBy: actorId,
    };
  }

  /**
   * Pick the copyable scalar fields off a source panel — those present on the
   * BranchRadiologyPanel model, minus identity/scope/source/provenance/timestamp
   * columns that the caller sets fresh. Filtering against the BranchRadiologyPanel
   * scalar-field set drops any master-only column automatically, so future
   * RadiologyPanel additions can't break import/sync.
   */
  private extractScalars(source: RadiologyPanel): Record<string, unknown> {
    const validFields = new Set<string>(
      Object.keys(Prisma.BranchRadiologyPanelScalarFieldEnum),
    );
    const dropKeys = new Set<string>([
      'id',
      'tenantId',
      'branchId',
      'masterDataId',
      'source',
      'clonedFromId',
      'templateSyncedAt',
      'sourceMasterRadiologyPanelId',
      'sourceRadiologyPanelId',
      'sourceMasterDataId',
      'listId',
      'listPrice',
      'isDefault',
      'isDuplicate',
      'createdBy',
      'updatedBy',
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
      throw new BranchRadiologyPanelDefaultConflictException();
    }
  }
}
