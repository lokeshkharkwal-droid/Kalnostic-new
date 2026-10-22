import { Injectable } from '@nestjs/common';
import {
  DataSource,
  Prisma,
  RadiologyPanel,
  RadiologyPanelTest,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import {
  KaltrosException,
  ValidationException,
} from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { RadiologyTestService } from '../radiology-test/radiology-test.service';
import { CreateRadiologyPanelDto } from './dto/create-radiology-panel.dto';
import { UpdateRadiologyPanelDto } from './dto/update-radiology-panel.dto';
import {
  BrowseRadiologyPanelTemplatesDto,
  ListRadiologyPanelsDto,
} from './dto/list-radiology-panels.dto';
import { ImportRadiologyPanelTemplatesDto } from './dto/import-radiology-panel-templates.dto';
import { SyncRadiologyPanelTemplatesDto } from './dto/sync-radiology-panel-templates.dto';
import { RadiologyPanelTestDto } from './dto/radiology-panel-test.dto';
import {
  ClassificationRef,
  ImportableRadiologyPanelTemplateRow,
  RadiologyPanelCloneResult,
  RadiologyPanelImportResult,
  RadiologyPanelListRow,
  RadiologyPanelSyncResult,
  RadiologyPanelTestWithDetails,
  RadiologyPanelWithRefs,
  RadiologyPanelWithTests,
} from './entities/radiology-panel.entity';
import {
  RadiologyPanelCodeConflictException,
  RadiologyPanelNameConflictException,
  RadiologyPanelNotFoundException,
  RadiologyPanelTestNotFoundException,
} from './exceptions/radiology-panel.exceptions';

/** Row keys that are re-derived (never copied) when cloning a panel. */
const PANEL_META_KEYS = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'source',
  'clonedFromId',
  'templateSyncedAt',
  'sourceMasterRadiologyPanelId',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

/** The cross-field configuration validated by `assertPriceOrdering`. */
interface PanelPrices {
  priceMsrp: number;
  priceMaximum: number;
  priceMinimum: number;
}

/**
 * Radiology-panel configuration management. Tenant-scoped + branch-level; every
 * panel lives inside a master data (`masterDataId`) whose tenant/branch it
 * inherits. A panel groups several radiology tests (managed nested via
 * `RadiologyPanelTest`). Mirrors `LabPanelService` for the nested-member CRUD,
 * SITE_ADMIN template, clone, import and sync flows, adapted to the (flat)
 * radiology test model — the per-id template import/sync mirrors
 * `RadiologyTestService`. Prisma-direct; multi-step writes run in `withTenant`
 * transactions. Price ordering is validated here (defence in front of the CHECK
 * constraints in prisma/rls.sql).
 */
@Injectable()
export class RadiologyPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: MasterDataService,
    private readonly radiologyTestService: RadiologyTestService,
  ) {}

  /**
   * Create a radiology panel inside a master data, with its included tests. The
   * master data is validated to belong to the caller's tenant (and supplies
   * `branchId`). Every `radiologyTestId` is validated to reference an active
   * radiology test in the same master data. All inserts run in one transaction.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param dto validated payload
   * @returns the created radiology panel with its tests
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws ValidationException on a price-ordering violation
   * @throws RadiologyPanelTestNotFoundException if a test reference is invalid
   * @throws RadiologyPanelNameConflictException / RadiologyPanelCodeConflictException
   */
  async create(
    masterDataId: string,
    tenantId: string,
    dto: CreateRadiologyPanelDto,
  ): Promise<RadiologyPanelWithTests> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );
    const { tests = [], ...scalars } = dto;
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? 0,
      priceMaximum: dto.priceMaximum ?? 0,
      priceMinimum: dto.priceMinimum ?? 0,
    });
    await this.assertTestRefs(masterDataId, tenantId, tests);
    let createdId: string;
    try {
      createdId = await this.prisma.withTenant(tenantId, async (tx) => {
        const panel = await tx.radiologyPanel.create({
          data: {
            ...scalars,
            tenantId,
            branchId: masterData.branchId,
            masterDataId,
          },
        });
        await this.createTests(
          tx,
          tenantId,
          masterData.branchId,
          panel.id,
          tests,
        );
        return panel.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.panelName, dto.panelCode);
      throw e;
    }
    return this.findById(masterDataId, createdId, tenantId);
  }

  /**
   * Fetch one radiology panel composed with its included tests (ordered by
   * sortOrder).
   * @param masterDataId parent master data id
   * @param panelId radiology panel id
   * @param tenantId tenant scope
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/other master data
   */
  async findById(
    masterDataId: string,
    panelId: string,
    tenantId: string,
  ): Promise<RadiologyPanelWithTests> {
    const panel = await this.findCoreById(panelId, masterDataId, tenantId);
    const [withRefsList, tests] = await Promise.all([
      this.attachRefs(tenantId, [panel]),
      this.prisma.radiologyPanelTest.findMany({
        where: { radiologyPanelId: panelId, tenantId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const withRefs = withRefsList[0];
    if (!withRefs) {
      throw new RadiologyPanelNotFoundException(panelId);
    }
    const testsWithDetails = await this.attachTestDetails(tenantId, tests);
    return { ...withRefs, tests: testsWithDetails };
  }

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /radiology-panels/options`). Tenant-scoped to active, non-deleted
   * radiology panels; optionally filtered by `branchId` and a case-insensitive
   * `panelName` search. Returns the full array when `page` is omitted, or a
   * paginated envelope when `page` is supplied.
   * @param tenantId tenant scope
   * @param filters optional `branchId`, `search`, and opt-in `page`/`limit`
   */
  async findOptions(
    tenantId: string,
    filters: {
      branchId?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<
    | Array<{ id: string; name: string }>
    | PaginatedResult<{ id: string; name: string }>
  > {
    const where: Prisma.RadiologyPanelWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
    };
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    const search = filters.search?.trim();
    if (search) {
      where.panelName = { contains: search, mode: 'insensitive' };
    }

    const select = { id: true, panelName: true } as const;
    const orderBy = { panelName: 'asc' } as const;

    if (filters.page === undefined) {
      const rows = await this.prisma.radiologyPanel.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.panelName }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.radiologyPanel.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.radiologyPanel.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.panelName })),
      total,
      page,
      limit,
    };
  }

  /**
   * List active radiology panels in a master data (offset pagination; core rows
   * only).
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async findAll(
    masterDataId: string,
    tenantId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<RadiologyPanelWithRefs>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const where = { masterDataId, tenantId, deletedAt: null };
    const panels = await this.prisma.radiologyPanel.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.radiologyPanel.count({ where });
    const data = await this.attachRefs(tenantId, panels);
    return { data, total, page, limit };
  }

  /**
   * List radiology panels in a master data for the listing screen: search by
   * `panelName`/`panelCode`, filter by parent category/department + status, and
   * paginate. Each row carries resolved category/department names and the count
   * of included tests.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param query search + filters + pagination
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async listForListing(
    masterDataId: string,
    tenantId: string,
    query: ListRadiologyPanelsDto,
  ): Promise<PaginatedResult<RadiologyPanelListRow>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.RadiologyPanelWhereInput = {
      masterDataId,
      tenantId,
      deletedAt: null,
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { panelName: { contains: search, mode: 'insensitive' } },
        { panelCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.status) where.isActive = query.status === 'ACTIVE';

    const sort = this.buildListOrderBy(query.sortBy, query.sortOrder);

    // Derived sorts (category name / included-test count) can't be expressed as a
    // Prisma `orderBy`, so sort the whole filtered set by the computed value
    // first, then paginate.
    if (sort.kind === 'derived') {
      const panels = await this.sortByDerived(
        where,
        tenantId,
        sort.field,
        sort.dir,
        page,
        limit,
      );
      const total = await this.prisma.radiologyPanel.count({ where });
      const data = await this.projectListRows(tenantId, panels);
      return { data, total, page, limit };
    }

    const [panels, total] = await Promise.all([
      this.prisma.radiologyPanel.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: sort.orderBy,
      }),
      this.prisma.radiologyPanel.count({ where }),
    ]);

    const data = await this.projectListRows(tenantId, panels);
    return { data, total, page, limit };
  }

  /**
   * Resolve a listing `sortBy`/`sortOrder` (`1` asc / `-1` desc) into either a
   * Prisma `orderBy` (scalar column) or a `derived` marker for the category-name
   * / test-count sorts handled in-memory. Falls back to `createdAt desc` when no
   * sort is requested.
   */
  private buildListOrderBy(
    sortBy: ListRadiologyPanelsDto['sortBy'],
    sortOrder: ListRadiologyPanelsDto['sortOrder'],
  ):
    | { kind: 'prisma'; orderBy: Prisma.RadiologyPanelOrderByWithRelationInput }
    | {
        kind: 'derived';
        field: 'panelCategory' | 'testsCount';
        dir: 'asc' | 'desc';
      } {
    const dir: 'asc' | 'desc' = sortOrder === -1 ? 'desc' : 'asc';
    if (!sortBy) {
      return { kind: 'prisma', orderBy: { createdAt: 'desc' } };
    }
    if (sortBy === 'panelCategory' || sortBy === 'testsCount') {
      return { kind: 'derived', field: sortBy, dir };
    }
    return { kind: 'prisma', orderBy: { [sortBy]: dir } };
  }

  /**
   * Sort the whole filtered set of panels by a derived value — the resolved
   * category name (`panelCategory`) or the active included-test count
   * (`testsCount`) — then return the requested page's rows in sorted order.
   * Null/empty category names sink to the bottom (matching the grid); ties break
   * by newest-first so paging is stable. Runs before pagination so the order is
   * global.
   */
  private async sortByDerived(
    where: Prisma.RadiologyPanelWhereInput,
    tenantId: string,
    field: 'panelCategory' | 'testsCount',
    dir: 'asc' | 'desc',
    page: number,
    limit: number,
  ): Promise<RadiologyPanel[]> {
    const all = await this.prisma.radiologyPanel.findMany({
      where,
      select: { id: true, categoryId: true, createdAt: true },
    });
    if (all.length === 0) {
      return [];
    }
    const factor = dir === 'asc' ? 1 : -1;

    let pageIds: string[];
    if (field === 'testsCount') {
      const counts = await this.countTestsByPanel(
        tenantId,
        all.map((p) => p.id),
      );
      pageIds = all
        .map((p) => ({
          id: p.id,
          createdAt: p.createdAt,
          value: counts.get(p.id) ?? 0,
        }))
        .sort((a, b) =>
          a.value !== b.value
            ? (a.value - b.value) * factor
            : b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .slice((page - 1) * limit, page * limit)
        .map((x) => x.id);
    } else {
      const cats = await this.resolveRefs(
        'category',
        tenantId,
        all.map((p) => p.categoryId),
      );
      pageIds = all
        .map((p) => ({
          id: p.id,
          createdAt: p.createdAt,
          value: this.refOf(cats, p.categoryId)?.name ?? '',
        }))
        .sort((a, b) => {
          // Empty names always sink to the bottom, regardless of direction.
          if (!a.value && !b.value)
            return b.createdAt.getTime() - a.createdAt.getTime();
          if (!a.value) return 1;
          if (!b.value) return -1;
          const cmp = a.value.localeCompare(b.value, undefined, {
            numeric: true,
            sensitivity: 'base',
          });
          return cmp !== 0
            ? cmp * factor
            : b.createdAt.getTime() - a.createdAt.getTime();
        })
        .slice((page - 1) * limit, page * limit)
        .map((x) => x.id);
    }

    const rows = await this.prisma.radiologyPanel.findMany({
      where: { id: { in: pageIds } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return pageIds
      .map((id) => byId.get(id))
      .filter((r): r is RadiologyPanel => r !== undefined);
  }

  /**
   * Update a radiology panel. Core fields are patched; when `tests` is provided,
   * the whole included-test set is replaced (old active rows soft-deleted, the new
   * set created) in one transaction.
   * @param masterDataId parent master data id
   * @param panelId radiology panel id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws RadiologyPanelNotFoundException / ValidationException / conflict exceptions
   * @throws RadiologyPanelTestNotFoundException if a test reference is invalid
   */
  async update(
    masterDataId: string,
    panelId: string,
    tenantId: string,
    dto: UpdateRadiologyPanelDto,
  ): Promise<RadiologyPanelWithTests> {
    const existing = await this.findCoreById(panelId, masterDataId, tenantId);
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? existing.priceMsrp,
      priceMaximum: dto.priceMaximum ?? existing.priceMaximum,
      priceMinimum: dto.priceMinimum ?? existing.priceMinimum,
    });
    if (dto.tests !== undefined) {
      await this.assertTestRefs(masterDataId, tenantId, dto.tests);
    }

    const { tests, ...scalars } = dto;
    const now = new Date();
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.radiologyPanel.update({
          where: { id: panelId },
          data: scalars,
        });
        if (tests !== undefined) {
          await tx.radiologyPanelTest.updateMany({
            where: { radiologyPanelId: panelId, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createTests(
            tx,
            tenantId,
            existing.branchId,
            panelId,
            tests,
          );
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.panelName ?? '', dto.panelCode ?? '');
      throw e;
    }
    return this.findById(masterDataId, panelId, tenantId);
  }

  /**
   * Soft-delete a radiology panel and cascade soft-delete its included tests in one
   * transaction.
   * @param masterDataId parent master data id
   * @param panelId radiology panel id
   * @param tenantId tenant scope
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/other master data
   */
  async remove(
    masterDataId: string,
    panelId: string,
    tenantId: string,
  ): Promise<RadiologyPanel> {
    await this.findCoreById(panelId, masterDataId, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      this.cascadeDeletePanel(tx, panelId, tenantId, new Date()),
    );
  }

  /**
   * Clone all active radiology panels from a source master data into a target
   * master data (duplicate name/code skipped). Both are validated to belong to
   * the caller's tenant. Each panel's member tests are rebuilt against the
   * target's own tests by code match (members with no match are dropped).
   * @param sourceMasterDataId source master data (the `:masterDataId` path param)
   * @param targetMasterDataId target master data
   * @param tenantId tenant scope
   * @returns `{ copied, skipped }`
   */
  async cloneAll(
    sourceMasterDataId: string,
    targetMasterDataId: string,
    tenantId: string,
  ): Promise<RadiologyPanelCloneResult> {
    await this.masterDataService.findById(sourceMasterDataId, tenantId);
    const target = await this.masterDataService.findById(
      targetMasterDataId,
      tenantId,
    );
    return this.prisma.withTenant(tenantId, async (tx) => {
      const sourcePanels = await tx.radiologyPanel.findMany({
        where: { masterDataId: sourceMasterDataId, tenantId, deletedAt: null },
      });
      const existing = await tx.radiologyPanel.findMany({
        where: { masterDataId: targetMasterDataId, tenantId, deletedAt: null },
        select: { panelName: true, panelCode: true },
      });
      const names = new Set(existing.map((p) => p.panelName));
      const codes = new Set(existing.map((p) => p.panelCode));
      // Map the target's own test codes → ids so copied members point at the
      // target master data's tests (logical refs are master-data scoped).
      const targetTestIdByCode = await this.loadTestIdByCode(
        tx,
        targetMasterDataId,
        tenantId,
      );

      let copied = 0;
      let skipped = 0;
      for (const src of sourcePanels) {
        if (names.has(src.panelName) || codes.has(src.panelCode)) {
          skipped += 1;
          continue;
        }
        const members = await tx.radiologyPanelTest.findMany({
          where: { radiologyPanelId: src.id, tenantId, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        });
        const panel = await tx.radiologyPanel.create({
          data: {
            ...this.stripMeta(src),
            tenantId,
            branchId: target.branchId,
            masterDataId: targetMasterDataId,
            source: DataSource.TENANT,
          } as Prisma.RadiologyPanelUncheckedCreateInput,
        });
        await this.createRemappedMembers(
          tx,
          tenantId,
          target.branchId,
          panel.id,
          members,
          async (m) => targetTestIdByCode.get(await this.testCode(tx, m)),
        );
        copied += 1;
      }
      return { copied, skipped };
    });
  }

  /**
   * The Tenant→Branch radiology master-data sync ("Import Master Data" on the
   * branch-admin Radiology Master Data page). Syncs the tenant's Tenant Master
   * Data radiology tests + panels into the caller's active Branch Master Data
   * (full overwrite). Mirrors `LabPanelService.syncTenantToBranch`: tests are
   * synced first (producing a `tenantTestId → branchTestId` map), then panels are
   * synced with their membership remapped through that map. Both run in one
   * widened-timeout transaction so the whole sync is atomic.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded on cloned rows' seed version (or null)
   */
  async syncTenantToBranch(
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<{
    tests: { created: number; updated: number; deleted: number };
    panels: { created: number; updated: number; deleted: number };
  }> {
    const tenantMd =
      await this.masterDataService.getOrCreateTenantMasterData(tenantId);
    const branchMd = await this.masterDataService.getOrCreateBranchMasterData(
      tenantId,
      branchId,
    );
    return this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const t = await this.radiologyTestService.syncTestsIntoBranch(tx, {
          tenantId,
          branchId,
          tenantMasterDataId: tenantMd.id,
          branchMasterDataId: branchMd.id,
          actorId,
        });
        const p = await this.syncPanelsIntoBranch(
          tx,
          {
            tenantId,
            branchId,
            tenantMasterDataId: tenantMd.id,
            branchMasterDataId: branchMd.id,
          },
          t.testIdMap,
        );
        return {
          tests: { created: t.created, updated: t.updated, deleted: t.deleted },
          panels: p,
        };
      },
      // Match the lab sync's widened bound: a per-panel loop (overwrite +
      // membership rebuild) over a full catalogue can run past Prisma's default
      // 5s transaction timeout; tests + panels must stay in one tx (panels need
      // the complete in-memory testIdMap).
      { timeout: 300_000, maxWait: 15_000 },
    );
  }

  /**
   * Sync (update-or-create-or-delete) all active panels from a Tenant Master Data
   * into a Branch Master Data, keyed on `sourceMasterRadiologyPanelId` (falling
   * back to `panelCode`). A matched branch panel is fully overwritten and its
   * membership rebuilt; an unmatched one is created. Panel membership
   * `radiologyTestId`s are remapped through `testIdMap` (built by the test sync)
   * to the branch test copies; members with no mapping are dropped. A branch
   * panel whose tenant source has been soft-deleted is itself soft-deleted
   * (cascading its membership) — UNLESS its `sourceMasterRadiologyPanelId` is
   * NULL (hand-created/never synced), which is always left untouched. Runs inside
   * the caller's tx.
   */
  private async syncPanelsIntoBranch(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      branchId: string;
      tenantMasterDataId: string;
      branchMasterDataId: string;
    },
    testIdMap: Map<string, string>,
  ): Promise<{ created: number; updated: number; deleted: number }> {
    const { tenantId, branchId, tenantMasterDataId, branchMasterDataId } =
      params;
    const sourcePanels = await tx.radiologyPanel.findMany({
      where: { masterDataId: tenantMasterDataId, tenantId, deletedAt: null },
    });
    const branchPanels = await tx.radiologyPanel.findMany({
      where: { masterDataId: branchMasterDataId, tenantId, deletedAt: null },
    });
    const bySource = new Map<string, RadiologyPanel>();
    const byCode = new Map<string, RadiologyPanel>();
    for (const p of branchPanels) {
      if (p.sourceMasterRadiologyPanelId)
        bySource.set(p.sourceMasterRadiologyPanelId, p);
      byCode.set(p.panelCode, p);
    }
    const sourcePanelIds = new Set(sourcePanels.map((p) => p.id));

    let created = 0;
    let updated = 0;
    for (const src of sourcePanels) {
      const members = await tx.radiologyPanelTest.findMany({
        where: { radiologyPanelId: src.id, tenantId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      const target = bySource.get(src.id) ?? byCode.get(src.panelCode);
      let panelId: string;
      if (target) {
        await tx.radiologyPanel.update({
          where: { id: target.id },
          data: {
            ...this.stripMeta(src),
            sourceMasterRadiologyPanelId: src.id,
          },
        });
        await tx.radiologyPanelTest.deleteMany({
          where: { radiologyPanelId: target.id, tenantId },
        });
        panelId = target.id;
        updated += 1;
      } else {
        const panel = await tx.radiologyPanel.create({
          data: {
            ...this.stripMeta(src),
            tenantId,
            branchId,
            masterDataId: branchMasterDataId,
            source: DataSource.TENANT,
            sourceMasterRadiologyPanelId: src.id,
          } as Prisma.RadiologyPanelUncheckedCreateInput,
        });
        panelId = panel.id;
        created += 1;
      }
      await this.createRemappedMembers(
        tx,
        tenantId,
        branchId,
        panelId,
        members,
        async (m) => testIdMap.get(m.radiologyTestId),
      );
    }

    const now = new Date();
    let deleted = 0;
    const orphans = branchPanels.filter(
      (p) =>
        p.sourceMasterRadiologyPanelId !== null &&
        !sourcePanelIds.has(p.sourceMasterRadiologyPanelId),
    );
    for (const orphan of orphans) {
      await this.cascadeDeletePanel(tx, orphan.id, tenantId, now);
      deleted += 1;
    }

    return { created, updated, deleted };
  }

  // ── Site Admin global templates ─────────────────────────────────────────────────

  /**
   * Create a SITE_ADMIN global template radiology panel (no tenant/branch/master
   * data). Reuses `CreateRadiologyPanelDto` but forces the (tenant-scoped)
   * category/department refs NULL. Every included `radiologyTestId` must
   * reference an active SITE_ADMIN template radiology test. Runs in a plain
   * transaction (no tenant GUC).
   * @param dto validated payload (classification refs ignored)
   * @throws ValidationException on a price-ordering violation
   * @throws RadiologyPanelTestNotFoundException if a test reference isn't a live template test
   * @throws RadiologyPanelNameConflictException / RadiologyPanelCodeConflictException
   */
  async createTemplate(
    dto: CreateRadiologyPanelDto,
  ): Promise<RadiologyPanelWithTests> {
    const { tests = [], ...scalars } = dto;
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? 0,
      priceMaximum: dto.priceMaximum ?? 0,
      priceMinimum: dto.priceMinimum ?? 0,
    });
    await this.assertTemplateTestRefs(tests);
    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(async (tx) => {
        const panel = await tx.radiologyPanel.create({
          data: {
            ...scalars,
            categoryId: null,
            departmentId: null,
            tenantId: null,
            branchId: null,
            masterDataId: null,
            source: DataSource.SITE_ADMIN,
          },
        });
        await this.createTests(tx, null, null, panel.id, tests);
        return panel.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.panelName, dto.panelCode);
      throw e;
    }
    return this.findTemplateById(createdId);
  }

  /**
   * List SITE_ADMIN template radiology panels (with test counts; no tenant
   * classification refs). Supports `search`, `status` → `isActive`, and (for a
   * business caller supplying `tenantId` + `masterDataId`) an `isImported`
   * annotation per row.
   * @param query search + status + pagination
   * @param tenantId optional business tenant (enables `isImported`)
   */
  async findAllTemplates(
    query: BrowseRadiologyPanelTemplatesDto = {},
    tenantId?: string,
  ): Promise<PaginatedResult<ImportableRadiologyPanelTemplateRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.RadiologyPanelWhereInput = {
      source: DataSource.SITE_ADMIN,
      deletedAt: null,
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { panelName: { contains: search, mode: 'insensitive' } },
        { panelCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }

    let importedTemplateIds = new Set<string>();
    if (tenantId && query.masterDataId) {
      await this.masterDataService.findById(query.masterDataId, tenantId);
      const imported = await this.prisma.radiologyPanel.findMany({
        where: {
          tenantId,
          masterDataId: query.masterDataId,
          clonedFromId: { not: null },
          deletedAt: null,
        },
        select: { clonedFromId: true },
      });
      importedTemplateIds = new Set(
        imported
          .map((r) => r.clonedFromId)
          .filter((id): id is string => id !== null),
      );
      if (query.notImportedOnly && importedTemplateIds.size) {
        where.id = { notIn: [...importedTemplateIds] };
      }
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const [panels, total] = await Promise.all([
      this.prisma.radiologyPanel.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.radiologyPanel.count({ where }),
    ]);
    const counts = await this.countTestsByPanel(
      null,
      panels.map((p) => p.id),
    );
    const data: ImportableRadiologyPanelTemplateRow[] = panels.map((p) => ({
      ...p,
      category: null,
      department: null,
      testsCount: counts.get(p.id) ?? 0,
      isImported: importedTemplateIds.has(p.id),
    }));
    return { data, total, page, limit };
  }

  /**
   * Fetch one SITE_ADMIN template radiology panel composed with its included
   * tests.
   * @param panelId template id
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/not a template
   */
  async findTemplateById(panelId: string): Promise<RadiologyPanelWithTests> {
    const panel = await this.findCoreTemplateById(panelId);
    const tests = await this.prisma.radiologyPanelTest.findMany({
      where: { radiologyPanelId: panelId, tenantId: null, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    const testsWithDetails = await this.attachTestDetails(null, tests);
    return {
      ...panel,
      category: null,
      department: null,
      tests: testsWithDetails,
    };
  }

  /**
   * Update a SITE_ADMIN template radiology panel (same test-replacement semantics
   * as `update`). Classification refs stay NULL; replacement tests must be
   * SITE_ADMIN template tests. Runs in a plain transaction.
   * @param panelId template id
   * @param dto partial update (classification refs ignored)
   * @throws RadiologyPanelNotFoundException / ValidationException / conflict exceptions
   * @throws RadiologyPanelTestNotFoundException if a test reference isn't a live template test
   */
  async updateTemplate(
    panelId: string,
    dto: UpdateRadiologyPanelDto,
  ): Promise<RadiologyPanelWithTests> {
    const existing = await this.findCoreTemplateById(panelId);
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? existing.priceMsrp,
      priceMaximum: dto.priceMaximum ?? existing.priceMaximum,
      priceMinimum: dto.priceMinimum ?? existing.priceMinimum,
    });
    if (dto.tests !== undefined) {
      await this.assertTemplateTestRefs(dto.tests);
    }
    const { tests, ...scalars } = dto;
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.radiologyPanel.update({
          where: { id: panelId },
          data: { ...scalars, categoryId: null, departmentId: null },
        });
        if (tests !== undefined) {
          await tx.radiologyPanelTest.updateMany({
            where: {
              radiologyPanelId: panelId,
              tenantId: null,
              deletedAt: null,
            },
            data: { deletedAt: now },
          });
          await this.createTests(tx, null, null, panelId, tests);
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.panelName ?? '', dto.panelCode ?? '');
      throw e;
    }
    return this.findTemplateById(panelId);
  }

  /**
   * Soft-delete a SITE_ADMIN template radiology panel and cascade soft-delete its
   * included tests, in one transaction.
   * @param panelId template id
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/not a template
   */
  async removeTemplate(panelId: string): Promise<RadiologyPanel> {
    await this.findCoreTemplateById(panelId);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.radiologyPanelTest.updateMany({
        where: { radiologyPanelId: panelId, tenantId: null, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.radiologyPanel.update({
        where: { id: panelId },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Lightweight `{ id, name }` options for SITE_ADMIN template radiology panels
   * (`GET /siteadmin/radiology-panels/options`). Returns the full array when
   * `page` is omitted, or a paginated envelope when `page` is supplied.
   * @param filters optional `search` and opt-in `page`/`limit`
   */
  async findTemplateOptions(
    filters: {
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<
    | Array<{ id: string; name: string }>
    | PaginatedResult<{ id: string; name: string }>
  > {
    const where: Prisma.RadiologyPanelWhereInput = {
      source: DataSource.SITE_ADMIN,
      tenantId: null,
      deletedAt: null,
      isActive: true,
    };
    const search = filters.search?.trim();
    if (search) {
      where.panelName = { contains: search, mode: 'insensitive' };
    }

    const select = { id: true, panelName: true } as const;
    const orderBy = { panelName: 'asc' } as const;

    if (filters.page === undefined) {
      const rows = await this.prisma.radiologyPanel.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.panelName }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.radiologyPanel.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.radiologyPanel.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.panelName })),
      total,
      page,
      limit,
    };
  }

  /**
   * Clone a SITE_ADMIN template radiology panel into a tenant's catalogue
   * (business-user flow). `tenantId` comes from the caller's JWT; `branchId` from
   * the target master data; only `masterDataId` is client-supplied. The template's
   * referenced SITE_ADMIN radiology tests are cloned into the tenant FIRST
   * (deduplicated within the request) so the new panel references tenant-owned
   * tests, not the templates. The whole operation — panel, cloned tests, and join
   * rows — is one transaction. The new panel tracks `clonedFromId = templateId`.
   * @param templateId the SITE_ADMIN template panel to clone
   * @param tenantId caller's tenant
   * @param masterDataId target master data (validated against the tenant)
   * @returns the newly-created tenant radiology panel with its tests
   * @throws RadiologyPanelNotFoundException if `templateId` is not a live template
   * @throws RadiologyTestNotFoundException if a referenced template test is missing
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws RadiologyPanelNameConflictException / RadiologyPanelCodeConflictException
   */
  async cloneToTenant(
    templateId: string,
    tenantId: string,
    masterDataId: string,
  ): Promise<RadiologyPanelWithTests> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );
    const template = await this.findCoreTemplateById(templateId);
    let newId: string;
    try {
      newId = await this.prisma.withTenant(tenantId, (tx) =>
        this.cloneTemplatePanelWithinTx(tx, template, {
          tenantId,
          branchId: masterData.branchId,
          masterDataId,
        }),
      );
    } catch (e) {
      this.rethrowConflict(e, template.panelName, template.panelCode);
      throw e;
    }
    return this.findById(masterDataId, newId, tenantId);
  }

  /**
   * Bulk-import SITE_ADMIN template radiology panels into a tenant's master data.
   * Each template is imported in its own transaction so one failure never aborts
   * the batch: already-imported templates (tracked by `clonedFromId`) are
   * skipped, missing/deleted templates and name/code conflicts are reported. Each
   * template's referenced SITE_ADMIN tests are cloned into the tenant too.
   * @param tenantId tenant scope (from the JWT)
   * @param dto target master data + SITE_ADMIN template ids
   * @returns an `{ imported, skipped, failed }` summary
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async importTemplates(
    tenantId: string,
    dto: ImportRadiologyPanelTemplatesDto,
  ): Promise<RadiologyPanelImportResult> {
    const masterData = await this.masterDataService.findById(
      dto.masterDataId,
      tenantId,
    );
    const templates = await this.prisma.radiologyPanel.findMany({
      where: {
        id: { in: dto.templateIds },
        source: DataSource.SITE_ADMIN,
        deletedAt: null,
      },
    });
    const templateById = new Map(templates.map((t) => [t.id, t]));
    const already = await this.prisma.radiologyPanel.findMany({
      where: {
        tenantId,
        masterDataId: dto.masterDataId,
        clonedFromId: { in: dto.templateIds },
        deletedAt: null,
      },
      select: { clonedFromId: true },
    });
    const alreadyImported = new Set(
      already
        .map((r) => r.clonedFromId)
        .filter((id): id is string => id !== null),
    );

    const result: RadiologyPanelImportResult = {
      imported: [],
      skipped: [],
      failed: [],
    };
    for (const templateId of dto.templateIds) {
      const template = templateById.get(templateId);
      if (!template) {
        result.failed.push({
          templateId,
          reason: 'Template not found or no longer available',
        });
        continue;
      }
      if (alreadyImported.has(templateId)) {
        result.skipped.push({
          templateId,
          panelName: template.panelName,
          reason: 'Already imported into this master data',
        });
        continue;
      }
      try {
        const newId = await this.prisma.withTenant(tenantId, (tx) =>
          this.cloneTemplatePanelWithinTx(tx, template, {
            tenantId,
            branchId: masterData.branchId,
            masterDataId: dto.masterDataId,
          }),
        );
        result.imported.push({
          templateId,
          radiologyPanelId: newId,
          panelName: template.panelName,
        });
      } catch (e) {
        result.failed.push({
          templateId,
          panelName: template.panelName,
          reason: this.conflictReason(
            e,
            template.panelName,
            template.panelCode,
          ),
        });
      }
    }
    return result;
  }

  /**
   * Re-pull previously-imported radiology panels from their SITE_ADMIN templates.
   * The tenant copy's scalars are replaced from the template (and its member set
   * rebuilt from the template's referenced tests, re-cloning any missing tenant
   * copies) and `templateSyncedAt` is stamped; identity/scope/provenance are
   * preserved. Hand-created panels (`clonedFromId = null`) are never touched. Each
   * panel is synced in its own transaction so one failure never aborts the batch.
   * @param tenantId tenant scope (from the JWT)
   * @param dto master data + optional subset of tenant radiology-panel ids
   * @returns a `{ synced, skipped, failed }` summary
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async syncTemplates(
    tenantId: string,
    dto: SyncRadiologyPanelTemplatesDto,
  ): Promise<RadiologyPanelSyncResult> {
    const masterData = await this.masterDataService.findById(
      dto.masterDataId,
      tenantId,
    );
    const where: Prisma.RadiologyPanelWhereInput = {
      tenantId,
      masterDataId: dto.masterDataId,
      clonedFromId: { not: null },
      deletedAt: null,
    };
    if (dto.radiologyPanelIds?.length) {
      where.id = { in: dto.radiologyPanelIds };
    }
    const panels = await this.prisma.radiologyPanel.findMany({ where });

    const result: RadiologyPanelSyncResult = {
      synced: [],
      skipped: [],
      failed: [],
    };
    for (const panel of panels) {
      const templateId = panel.clonedFromId;
      if (!templateId) {
        continue;
      }
      const template = await this.prisma.radiologyPanel.findFirst({
        where: {
          id: templateId,
          source: DataSource.SITE_ADMIN,
          deletedAt: null,
        },
      });
      if (!template) {
        result.skipped.push({
          radiologyPanelId: panel.id,
          panelName: panel.panelName,
          templateId,
          reason: 'Source template removed',
        });
        continue;
      }
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          const templateTests = await tx.radiologyPanelTest.findMany({
            where: {
              radiologyPanelId: templateId,
              tenantId: null,
              deletedAt: null,
            },
            orderBy: { sortOrder: 'asc' },
          });
          await tx.radiologyPanel.update({
            where: { id: panel.id },
            data: {
              ...this.stripMeta(template),
              templateSyncedAt: new Date(),
            },
          });
          await tx.radiologyPanelTest.updateMany({
            where: { radiologyPanelId: panel.id, tenantId, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          await this.cloneTemplateMembers(tx, templateTests, panel.id, {
            tenantId,
            branchId: masterData.branchId,
            masterDataId: dto.masterDataId,
          });
        });
        result.synced.push({
          radiologyPanelId: panel.id,
          panelName: template.panelName,
          templateId,
        });
      } catch (e) {
        result.failed.push({
          radiologyPanelId: panel.id,
          panelName: panel.panelName,
          templateId,
          reason: this.conflictReason(
            e,
            template.panelName,
            template.panelCode,
          ),
        });
      }
    }
    return result;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Clone a SITE_ADMIN template panel into a tenant inside an EXISTING
   * transaction: deep-copy the panel as a TENANT record tracking
   * `clonedFromId = template.id`, clone each referenced template test into the
   * tenant once, and create the remapped join rows. Returns the new panel id.
   */
  private async cloneTemplatePanelWithinTx(
    tx: Prisma.TransactionClient,
    template: RadiologyPanel,
    target: { tenantId: string; branchId: string | null; masterDataId: string },
  ): Promise<string> {
    const templateTests = await tx.radiologyPanelTest.findMany({
      where: {
        radiologyPanelId: template.id,
        tenantId: null,
        deletedAt: null,
      },
      orderBy: { sortOrder: 'asc' },
    });
    const panel = await tx.radiologyPanel.create({
      data: {
        ...this.stripMeta(template),
        tenantId: target.tenantId,
        branchId: target.branchId,
        masterDataId: target.masterDataId,
        source: DataSource.TENANT,
        clonedFromId: template.id,
      } as Prisma.RadiologyPanelUncheckedCreateInput,
    });
    await this.cloneTemplateMembers(tx, templateTests, panel.id, target);
    return panel.id;
  }

  /**
   * Clone a template panel's referenced SITE_ADMIN tests into the tenant (once
   * each, deduplicated) and create the join rows for `radiologyPanelId`. Runs
   * inside the caller's tx.
   */
  private async cloneTemplateMembers(
    tx: Prisma.TransactionClient,
    templateTests: RadiologyPanelTest[],
    radiologyPanelId: string,
    target: { tenantId: string; branchId: string | null; masterDataId: string },
  ): Promise<void> {
    const clonedTestIds = new Map<string, string>();
    const joinRows: Prisma.RadiologyPanelTestUncheckedCreateInput[] = [];
    for (const t of templateTests) {
      let newTestId = clonedTestIds.get(t.radiologyTestId);
      if (!newTestId) {
        const cloned =
          await this.radiologyTestService.cloneTemplateTestWithinTx(
            tx,
            t.radiologyTestId,
            {
              tenantId: target.tenantId,
              branchId: target.branchId,
              masterDataId: target.masterDataId,
            },
          );
        newTestId = cloned.id;
        clonedTestIds.set(t.radiologyTestId, newTestId);
      }
      joinRows.push({
        tenantId: target.tenantId,
        branchId: target.branchId,
        radiologyPanelId,
        radiologyTestId: newTestId,
        sortOrder: t.sortOrder,
        isRemovable: t.isRemovable,
        discountPercent: t.discountPercent,
      });
    }
    if (joinRows.length) {
      await tx.radiologyPanelTest.createMany({ data: joinRows });
    }
  }

  /**
   * Create join rows for a cloned panel, remapping each source member's test
   * through `resolveTestId` (e.g. by code into the target master data). Members
   * with no resolved test id are dropped.
   */
  private async createRemappedMembers(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    radiologyPanelId: string,
    members: RadiologyPanelTest[],
    resolveTestId: (m: RadiologyPanelTest) => Promise<string | undefined>,
  ): Promise<void> {
    const joinRows: Prisma.RadiologyPanelTestUncheckedCreateInput[] = [];
    for (const m of members) {
      const radiologyTestId = await resolveTestId(m);
      if (!radiologyTestId) {
        continue;
      }
      joinRows.push({
        tenantId,
        branchId,
        radiologyPanelId,
        radiologyTestId,
        sortOrder: m.sortOrder,
        isRemovable: m.isRemovable,
        discountPercent: m.discountPercent,
      });
    }
    if (joinRows.length) {
      await tx.radiologyPanelTest.createMany({ data: joinRows });
    }
  }

  /** Resolve a member's source test code (cached-free lookup inside a tx). */
  private async testCode(
    tx: Prisma.TransactionClient,
    member: RadiologyPanelTest,
  ): Promise<string> {
    const test = await tx.radiologyTest.findFirst({
      where: { id: member.radiologyTestId },
      select: { testCode: true },
    });
    return test?.testCode ?? '';
  }

  /** Map a master data's active radiology tests by `testCode` → id (inside a tx). */
  private async loadTestIdByCode(
    tx: Prisma.TransactionClient,
    masterDataId: string,
    tenantId: string,
  ): Promise<Map<string, string>> {
    const tests = await tx.radiologyTest.findMany({
      where: { masterDataId, tenantId, deletedAt: null },
      select: { id: true, testCode: true },
    });
    const map = new Map<string, string>();
    for (const t of tests) {
      map.set(t.testCode, t.id);
    }
    return map;
  }

  /**
   * Soft-delete cascade body shared by `remove()` (user-initiated) and future
   * cleanup paths. Assumes the caller has already validated the panel and owns the
   * tx.
   */
  private async cascadeDeletePanel(
    tx: Prisma.TransactionClient,
    panelId: string,
    tenantId: string,
    now: Date,
  ): Promise<RadiologyPanel> {
    await tx.radiologyPanelTest.updateMany({
      where: { radiologyPanelId: panelId, tenantId, deletedAt: null },
      data: { deletedAt: now },
    });
    return tx.radiologyPanel.update({
      where: { id: panelId },
      data: { deletedAt: now },
    });
  }

  /**
   * Project a page of panels into listing rows: the full panel enriched with its
   * `category`/`department` objects plus the count of included tests.
   * Classification refs and counts are batched over the page's ids (no N+1).
   */
  private async projectListRows(
    tenantId: string,
    panels: RadiologyPanel[],
  ): Promise<RadiologyPanelListRow[]> {
    if (panels.length === 0) {
      return [];
    }
    const [withRefs, testCounts] = await Promise.all([
      this.attachRefs(tenantId, panels),
      this.countTestsByPanel(
        tenantId,
        panels.map((p) => p.id),
      ),
    ]);
    return withRefs.map((p) => ({
      ...p,
      testsCount: testCounts.get(p.id) ?? 0,
    }));
  }

  /**
   * Fetch one active radiology panel (core row only) scoped to its tenant + master
   * data.
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/other master data
   */
  private async findCoreById(
    panelId: string,
    masterDataId: string,
    tenantId: string,
  ): Promise<RadiologyPanel> {
    const panel = await this.prisma.radiologyPanel.findFirst({
      where: { id: panelId, masterDataId, tenantId, deletedAt: null },
    });
    if (!panel) {
      throw new RadiologyPanelNotFoundException(panelId);
    }
    return panel;
  }

  /**
   * Fetch one active SITE_ADMIN template radiology panel (core row only).
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/not a template
   */
  private async findCoreTemplateById(panelId: string): Promise<RadiologyPanel> {
    const panel = await this.prisma.radiologyPanel.findFirst({
      where: { id: panelId, source: DataSource.SITE_ADMIN, deletedAt: null },
    });
    if (!panel) {
      throw new RadiologyPanelNotFoundException(panelId);
    }
    return panel;
  }

  /**
   * Insert a panel's included-test rows (no-op for an empty/absent list).
   * `tenantId` / `branchId` are NULL when the parent panel is a SITE_ADMIN
   * template.
   */
  private async createTests(
    tx: Prisma.TransactionClient,
    tenantId: string | null,
    branchId: string | null,
    radiologyPanelId: string,
    tests: RadiologyPanelTestDto[],
  ): Promise<void> {
    if (!tests.length) {
      return;
    }
    await tx.radiologyPanelTest.createMany({
      data: tests.map((t) => ({
        ...t,
        tenantId,
        branchId,
        radiologyPanelId,
      })),
    });
  }

  /** A shallow copy of a row with the re-derived meta keys removed (for cloning). */
  private stripMeta(row: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...row };
    for (const key of PANEL_META_KEYS) {
      delete copy[key];
    }
    return copy;
  }

  /**
   * Validate that every `radiologyTestId` references an active radiology test in
   * the same master data, that there are no duplicates within the panel, and that
   * each test's `discountPercent` (if set) doesn't exceed that test's own
   * `discountCapPct`.
   * @throws ValidationException on duplicate test references or a discount
   *   exceeding its test's cap
   * @throws RadiologyPanelTestNotFoundException on missing/foreign test references
   */
  private async assertTestRefs(
    masterDataId: string,
    tenantId: string,
    tests: RadiologyPanelTestDto[],
  ): Promise<void> {
    if (!tests.length) {
      return;
    }
    const ids = tests.map((t) => t.radiologyTestId);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new ValidationException('Duplicate test references in panel');
    }
    const found = await this.prisma.radiologyTest.findMany({
      where: {
        id: { in: [...unique] },
        masterDataId,
        tenantId,
        deletedAt: null,
      },
      select: { id: true, discountCapPct: true },
    });
    if (found.length !== unique.size) {
      const foundIds = new Set(found.map((t) => t.id));
      const missing = [...unique].filter((id) => !foundIds.has(id));
      throw new RadiologyPanelTestNotFoundException(missing);
    }
    const capById = new Map(found.map((t) => [t.id, t.discountCapPct]));
    for (const test of tests) {
      if (test.discountPercent == null) continue;
      const cap = capById.get(test.radiologyTestId) ?? 0;
      if (test.discountPercent > cap) {
        throw new ValidationException(
          `discountPercent (${test.discountPercent}) exceeds this test's discount cap (${cap})`,
        );
      }
    }
  }

  /**
   * Validate that every `radiologyTestId` references an active SITE_ADMIN template
   * radiology test, with no duplicates within the panel (template equivalent of
   * `assertTestRefs`, which is scoped to a tenant master data).
   * @throws ValidationException on duplicate test references
   * @throws RadiologyPanelTestNotFoundException on missing/non-template test references
   */
  private async assertTemplateTestRefs(
    tests: RadiologyPanelTestDto[],
  ): Promise<void> {
    if (!tests.length) {
      return;
    }
    const ids = tests.map((t) => t.radiologyTestId);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new ValidationException('Duplicate test references in panel');
    }
    const found = await this.prisma.radiologyTest.findMany({
      where: {
        id: { in: [...unique] },
        source: DataSource.SITE_ADMIN,
        deletedAt: null,
      },
      select: { id: true, discountCapPct: true },
    });
    if (found.length !== unique.size) {
      const foundIds = new Set(found.map((t) => t.id));
      const missing = [...unique].filter((id) => !foundIds.has(id));
      throw new RadiologyPanelTestNotFoundException(missing);
    }
    const capById = new Map(found.map((t) => [t.id, t.discountCapPct]));
    for (const test of tests) {
      if (test.discountPercent == null) continue;
      const cap = capById.get(test.radiologyTestId) ?? 0;
      if (test.discountPercent > cap) {
        throw new ValidationException(
          `discountPercent (${test.discountPercent}) exceeds this test's discount cap (${cap})`,
        );
      }
    }
  }

  /**
   * Enrich a page of panels with their resolved `category`/`department` objects
   * (`{ id, name }` or `null`). Batches the category + department lookups over the
   * page's ids (no N+1) and maps each panel to a `RadiologyPanelWithRefs`.
   */
  private async attachRefs(
    tenantId: string,
    panels: RadiologyPanel[],
  ): Promise<RadiologyPanelWithRefs[]> {
    if (panels.length === 0) {
      return [];
    }
    const [cats, depts] = await Promise.all([
      this.resolveRefs(
        'category',
        tenantId,
        panels.map((p) => p.categoryId),
      ),
      this.resolveRefs(
        'department',
        tenantId,
        panels.map((p) => p.departmentId),
      ),
    ]);
    return panels.map((p) => ({
      ...p,
      category: this.refOf(cats, p.categoryId),
      department: this.refOf(depts, p.departmentId),
    }));
  }

  /**
   * Resolve a set of classification ids to an `id → { id, name }` map
   * (tenant-scoped). Used to embed category/department objects into panel reads.
   */
  private async resolveRefs(
    model: 'category' | 'department',
    tenantId: string,
    idsRaw: (string | null)[],
  ): Promise<Map<string, ClassificationRef>> {
    const ids = [...new Set(idsRaw.filter((x): x is string => Boolean(x)))];
    const map = new Map<string, ClassificationRef>();
    if (ids.length === 0) {
      return map;
    }
    const where = { id: { in: ids }, tenantId };
    const select = { id: true, name: true };
    const rows =
      model === 'category'
        ? await this.prisma.category.findMany({ where, select })
        : await this.prisma.department.findMany({ where, select });
    for (const r of rows) {
      map.set(r.id, { id: r.id, name: r.name });
    }
    return map;
  }

  /** Look up a resolved classification ref by (possibly null) id. */
  private refOf(
    map: Map<string, ClassificationRef>,
    id: string | null,
  ): ClassificationRef | null {
    return id ? (map.get(id) ?? null) : null;
  }

  /**
   * Enrich a panel's included-test rows with their referenced `RadiologyTest`'s
   * display/pricing details (batched, no N+1). `radiologyTestId` is a logical
   * reference (no Prisma relation), so a test that no longer resolves (e.g.
   * hard-deleted) falls back to `null` fields rather than dropping the row — the
   * panel composition itself is preserved even if a referenced test is gone.
   */
  private async attachTestDetails(
    tenantId: string | null,
    tests: RadiologyPanelTest[],
  ): Promise<RadiologyPanelTestWithDetails[]> {
    if (tests.length === 0) {
      return [];
    }
    const ids = [...new Set(tests.map((t) => t.radiologyTestId))];
    const radiologyTests = await this.prisma.radiologyTest.findMany({
      where: { id: { in: ids }, tenantId },
      select: {
        id: true,
        testName: true,
        testCode: true,
        modality: true,
        priceMsrp: true,
        priceOriginal: true,
        priceMinimum: true,
        priceMaximum: true,
        discountCapPct: true,
      },
    });
    const testMap = new Map(radiologyTests.map((r) => [r.id, r]));
    return tests.map((t) => {
      const src = testMap.get(t.radiologyTestId);
      return {
        ...t,
        testName: src?.testName ?? null,
        testCode: src?.testCode ?? null,
        modality: src?.modality ?? null,
        priceMsrp: src?.priceMsrp ?? null,
        priceOriginal: src?.priceOriginal ?? null,
        priceMinimum: src?.priceMinimum ?? null,
        priceMaximum: src?.priceMaximum ?? null,
        discountCapPct: src?.discountCapPct ?? null,
      };
    });
  }

  /**
   * Count active included tests per panel, keyed by `radiologyPanelId`. `tenantId`
   * is NULL when counting tests of SITE_ADMIN template panels.
   */
  private async countTestsByPanel(
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (ids.length === 0) {
      return map;
    }
    const grouped = await this.prisma.radiologyPanelTest.groupBy({
      by: ['radiologyPanelId'],
      where: { radiologyPanelId: { in: ids }, tenantId, deletedAt: null },
      _count: { _all: true },
    });
    for (const g of grouped) {
      map.set(g.radiologyPanelId, g._count._all);
    }
    return map;
  }

  /** Enforce price ordering (min ≤ max ≤ msrp) ahead of the DB CHECK constraints. */
  private assertPriceOrdering(c: PanelPrices): void {
    if (c.priceMaximum > c.priceMsrp) {
      throw new ValidationException('priceMaximum must be ≤ priceMsrp', {
        priceMaximum: String(c.priceMaximum),
        priceMsrp: String(c.priceMsrp),
      });
    }
    if (c.priceMinimum > c.priceMaximum) {
      throw new ValidationException('priceMinimum must be ≤ priceMaximum', {
        priceMinimum: String(c.priceMinimum),
        priceMaximum: String(c.priceMaximum),
      });
    }
  }

  /**
   * Map a Prisma unique-constraint violation (P2002) to the matching typed 409.
   * The violated index name arrives in `error.meta.target`.
   */
  private rethrowConflict(
    e: unknown,
    panelName: string,
    panelCode: string,
  ): void {
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== 'P2002'
    ) {
      return;
    }
    const rawTarget = (e.meta as { target?: unknown } | undefined)?.target;
    const target = Array.isArray(rawTarget)
      ? rawTarget.join(',')
      : typeof rawTarget === 'string'
        ? rawTarget
        : '';
    if (target.includes('panel_code')) {
      throw new RadiologyPanelCodeConflictException(panelCode);
    }
    throw new RadiologyPanelNameConflictException(panelName);
  }

  /**
   * Human-readable reason for a per-row import/sync failure. Maps a P2002 to a
   * friendly message; falls back to a generic message for anything else.
   */
  private conflictReason(
    e: unknown,
    panelName: string,
    panelCode: string,
  ): string {
    if (e instanceof KaltrosException) {
      return e.message;
    }
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const rawTarget = (e.meta as { target?: unknown } | undefined)?.target;
      const target = Array.isArray(rawTarget)
        ? rawTarget.join(',')
        : typeof rawTarget === 'string'
          ? rawTarget
          : '';
      if (target.includes('panel_code')) {
        return `Panel code "${panelCode}" already exists in this master data`;
      }
      return `Panel name "${panelName}" already exists in this master data`;
    }
    return 'Unexpected error while importing this panel';
  }
}
