import { Injectable } from '@nestjs/common';
import {
  DataSource,
  Prisma,
  RadiologyPanel,
  RadiologyPanelTest,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { RadiologyMasterDataService } from '../radiology-master-data/radiology-master-data.service';
import { RadiologyTestService } from '../radiology-test/radiology-test.service';
import { CreateRadiologyPanelDto } from './dto/create-radiology-panel.dto';
import { UpdateRadiologyPanelDto } from './dto/update-radiology-panel.dto';
import { ListRadiologyPanelsDto } from './dto/list-radiology-panels.dto';
import {
  BulkEditRadiologyPanelItemDto,
  BulkEditRadiologyPanelsDto,
} from './dto/bulk-edit-radiology-panels.dto';
import { RadiologyPanelTestDto } from './dto/radiology-panel-test.dto';
import {
  ClassificationRef,
  RadiologyPanelListRow,
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

/** Result of a bulk edit: how many panels were updated. */
export interface BulkEditResult {
  updated: number;
}

/** Row keys that are re-derived (never copied) when cloning a panel. */
const PANEL_META_KEYS = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'source',
  'sourceMasterLabPanelId',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

/** The cross-field configuration validated by `assertCoreInvariants`. */
interface PanelInvariants {
  priceMsrp: number;
  priceMaximum: number;
  priceMinimum: number;
  isAllowPartialBilling: boolean;
  maxTestsRemovable: number;
  testsCount: number;
}

/**
 * Radiology-panel configuration management. Tenant-scoped + branch-level; every
 * panel lives inside a master data (`masterDataId`) whose tenant/branch it
 * inherits. A panel groups several radiology tests (managed nested via
 * `RadiologyPanelTest`). Prisma-direct; multi-step writes run in `withTenant`
 * transactions. Classification (`categoryId`/`departmentId`) are logical refs.
 */
@Injectable()
export class RadiologyPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: RadiologyMasterDataService,
    private readonly radiologyTestService: RadiologyTestService,
  ) {}

  /**
   * Create a radiology panel inside a master data, with its included tests. Every
   * `labTestId` is validated to reference an active radiology test in the same master
   * data. All inserts run in one transaction.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param dto validated payload
   * @returns the created radiology panel with its tests
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
    this.assertCoreInvariants({
      priceMsrp: dto.priceMsrp ?? 0,
      priceMaximum: dto.priceMaximum ?? 0,
      priceMinimum: dto.priceMinimum ?? 0,
      isAllowPartialBilling: dto.isAllowPartialBilling ?? false,
      maxTestsRemovable: dto.maxTestsRemovable ?? 0,
      testsCount: tests.length,
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
   * Fetch one radiology panel composed with its included tests (ordered by sortOrder).
   * @param masterDataId parent master data id
   * @param labPanelId radiology panel id
   * @param tenantId tenant scope
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/other master data
   */
  async findById(
    masterDataId: string,
    labPanelId: string,
    tenantId: string,
  ): Promise<RadiologyPanelWithTests> {
    const panel = await this.findCoreById(labPanelId, masterDataId, tenantId);
    const [withRefsList, tests] = await Promise.all([
      this.attachRefs(tenantId, [panel]),
      this.prisma.radiologyPanelTest.findMany({
        where: { labPanelId, tenantId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const withRefs = withRefsList[0];
    if (!withRefs) {
      throw new RadiologyPanelNotFoundException(labPanelId);
    }
    const testsWithDetails = await this.attachTestDetails(tenantId, tests);
    return { ...withRefs, tests: testsWithDetails };
  }

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /radiology-panels/options`). Full array when `page` omitted, else a
   * paginated envelope.
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
   * List active radiology panels in a master data (offset pagination; core rows).
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
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
   * List radiology panels in a master data for the listing screen: search, filter
   * by parent category/department + status, paginate. Each row carries resolved
   * category/department names and the count of included tests.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param query search + filters + pagination
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
   * Resolve a listing `sortBy`/`sortOrder` into either a Prisma `orderBy` or a
   * `derived` marker for the category-name / test-count sorts handled in-memory.
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
    const column =
      sortBy === 'homeCollectionAvailable' ? 'isHomeCollection' : sortBy;
    return { kind: 'prisma', orderBy: { [column]: dir } };
  }

  /**
   * Sort the whole filtered set of panels by a derived value — the resolved
   * category name or the active included-test count — then return the requested
   * page's rows in sorted order.
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
   * Update a radiology panel. Core fields are patched; when `tests` is provided, the
   * whole included-test set is replaced in one transaction.
   * @param masterDataId parent master data id
   * @param labPanelId radiology panel id
   * @param tenantId tenant scope
   * @param dto partial update
   */
  async update(
    masterDataId: string,
    labPanelId: string,
    tenantId: string,
    dto: UpdateRadiologyPanelDto,
  ): Promise<RadiologyPanelWithTests> {
    const existing = await this.findCoreById(
      labPanelId,
      masterDataId,
      tenantId,
    );

    const testsCount =
      dto.tests !== undefined
        ? dto.tests.length
        : await this.prisma.radiologyPanelTest.count({
            where: { labPanelId, tenantId, deletedAt: null },
          });
    this.assertCoreInvariants({
      priceMsrp: dto.priceMsrp ?? existing.priceMsrp,
      priceMaximum: dto.priceMaximum ?? existing.priceMaximum,
      priceMinimum: dto.priceMinimum ?? existing.priceMinimum,
      isAllowPartialBilling:
        dto.isAllowPartialBilling ?? existing.isAllowPartialBilling,
      maxTestsRemovable: dto.maxTestsRemovable ?? existing.maxTestsRemovable,
      testsCount,
    });
    if (dto.tests !== undefined) {
      await this.assertTestRefs(masterDataId, tenantId, dto.tests);
    }

    const { tests, ...scalars } = dto;
    const now = new Date();
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.radiologyPanel.update({
          where: { id: labPanelId },
          data: scalars,
        });
        if (tests !== undefined) {
          await tx.radiologyPanelTest.updateMany({
            where: { labPanelId, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createTests(
            tx,
            tenantId,
            existing.branchId,
            labPanelId,
            tests,
          );
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.panelName ?? '', dto.panelCode ?? '');
      throw e;
    }
    return this.findById(masterDataId, labPanelId, tenantId);
  }

  /**
   * Bulk-edit radiology panels: apply each item's scalar changes to its own
   * `labPanelId` (all scoped to the caller's tenant + the path's master data).
   * All-or-nothing.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param dto the array of per-panel edits
   * @returns the number of panels updated
   */
  async bulkEdit(
    masterDataId: string,
    tenantId: string,
    dto: BulkEditRadiologyPanelsDto,
  ): Promise<BulkEditResult> {
    await this.masterDataService.findById(masterDataId, tenantId);

    const items = dto.data;
    const ids = items.map((i) => i.labPanelId);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationException('Duplicate labPanelId in payload');
    }

    const edits = items.map((item) => {
      const { labPanelId, ...changes } = item;
      const data = this.pickDefined(changes);
      if (Object.keys(data).length === 0) {
        throw new ValidationException(
          `No changes provided for panel ${labPanelId}`,
        );
      }
      return { labPanelId, changes, data };
    });

    const panels = await this.prisma.radiologyPanel.findMany({
      where: { id: { in: ids }, masterDataId, tenantId, deletedAt: null },
    });
    const panelById = new Map(panels.map((p) => [p.id, p]));
    const missing = ids.find((id) => !panelById.has(id));
    if (missing) {
      throw new RadiologyPanelNotFoundException(missing);
    }

    const counts = await this.countTestsByPanel(tenantId, ids);
    for (const { labPanelId, changes } of edits) {
      const panel = panelById.get(labPanelId)!;
      this.assertCoreInvariants({
        priceMsrp: changes.priceMsrp ?? panel.priceMsrp,
        priceMaximum: changes.priceMaximum ?? panel.priceMaximum,
        priceMinimum: changes.priceMinimum ?? panel.priceMinimum,
        isAllowPartialBilling:
          changes.isAllowPartialBilling ?? panel.isAllowPartialBilling,
        maxTestsRemovable: changes.maxTestsRemovable ?? panel.maxTestsRemovable,
        testsCount: counts.get(labPanelId) ?? 0,
      });
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      for (const { labPanelId, data } of edits) {
        await tx.radiologyPanel.update({ where: { id: labPanelId }, data });
      }
    });
    return { updated: edits.length };
  }

  /**
   * Soft-delete a radiology panel and cascade soft-delete its included tests in one
   * transaction.
   * @param masterDataId parent master data id
   * @param labPanelId radiology panel id
   * @param tenantId tenant scope
   */
  async remove(
    masterDataId: string,
    labPanelId: string,
    tenantId: string,
  ): Promise<RadiologyPanel> {
    await this.findCoreById(labPanelId, masterDataId, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      this.cascadeDeletePanel(tx, labPanelId, tenantId, new Date()),
    );
  }

  /**
   * Soft-delete cascade body shared by `remove()` and `syncPanelsIntoBranch`.
   * Assumes the caller has validated the panel and owns the tx.
   */
  private async cascadeDeletePanel(
    tx: Prisma.TransactionClient,
    labPanelId: string,
    tenantId: string,
    now: Date,
  ): Promise<RadiologyPanel> {
    await tx.radiologyPanelTest.updateMany({
      where: { labPanelId, tenantId, deletedAt: null },
      data: { deletedAt: now },
    });
    return tx.radiologyPanel.update({
      where: { id: labPanelId },
      data: { deletedAt: now },
    });
  }

  // ── Site Admin global templates ─────────────────────────────────────────────────

  /**
   * Create a SITE_ADMIN global template radiology panel (no tenant/branch/master
   * data). Forces the category/department refs NULL. Every included `labTestId` must
   * reference an active SITE_ADMIN template radiology test. Runs in a plain
   * transaction.
   * @param dto validated payload (classification refs ignored)
   */
  async createTemplate(
    dto: CreateRadiologyPanelDto,
  ): Promise<RadiologyPanelWithTests> {
    const { tests = [], ...scalars } = dto;
    this.assertCoreInvariants({
      priceMsrp: dto.priceMsrp ?? 0,
      priceMaximum: dto.priceMaximum ?? 0,
      priceMinimum: dto.priceMinimum ?? 0,
      isAllowPartialBilling: dto.isAllowPartialBilling ?? false,
      maxTestsRemovable: dto.maxTestsRemovable ?? 0,
      testsCount: tests.length,
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
   * classification refs). Supports `search` and `status` → `isActive`.
   * @param query search + status + pagination
   */
  async findAllTemplates(
    query: ListRadiologyPanelsDto,
  ): Promise<PaginatedResult<RadiologyPanelListRow>> {
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
    const [panels, total] = await Promise.all([
      this.prisma.radiologyPanel.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.radiologyPanel.count({ where }),
    ]);
    const counts = await this.countTestsByPanel(
      null,
      panels.map((p) => p.id),
    );
    const data: RadiologyPanelListRow[] = panels.map((p) => ({
      ...p,
      category: null,
      department: null,
      testsCount: counts.get(p.id) ?? 0,
    }));
    return { data, total, page, limit };
  }

  /**
   * Fetch one SITE_ADMIN template radiology panel composed with its included tests.
   * @param labPanelId template id
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/not a template
   */
  async findTemplateById(labPanelId: string): Promise<RadiologyPanelWithTests> {
    const panel = await this.findCoreTemplateById(labPanelId);
    const tests = await this.prisma.radiologyPanelTest.findMany({
      where: { labPanelId, tenantId: null, deletedAt: null },
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
   * Update a SITE_ADMIN template radiology panel (same test-replacement semantics as
   * `update`). Classification refs stay NULL; replacement tests must be SITE_ADMIN
   * template tests. Runs in a plain transaction.
   * @param labPanelId template id
   * @param dto partial update (classification refs ignored)
   */
  async updateTemplate(
    labPanelId: string,
    dto: UpdateRadiologyPanelDto,
  ): Promise<RadiologyPanelWithTests> {
    const existing = await this.findCoreTemplateById(labPanelId);
    const testsCount =
      dto.tests !== undefined
        ? dto.tests.length
        : await this.prisma.radiologyPanelTest.count({
            where: { labPanelId, tenantId: null, deletedAt: null },
          });
    this.assertCoreInvariants({
      priceMsrp: dto.priceMsrp ?? existing.priceMsrp,
      priceMaximum: dto.priceMaximum ?? existing.priceMaximum,
      priceMinimum: dto.priceMinimum ?? existing.priceMinimum,
      isAllowPartialBilling:
        dto.isAllowPartialBilling ?? existing.isAllowPartialBilling,
      maxTestsRemovable: dto.maxTestsRemovable ?? existing.maxTestsRemovable,
      testsCount,
    });
    if (dto.tests !== undefined) {
      await this.assertTemplateTestRefs(dto.tests);
    }
    const { tests, ...scalars } = dto;
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.radiologyPanel.update({
          where: { id: labPanelId },
          data: { ...scalars, categoryId: null, departmentId: null },
        });
        if (tests !== undefined) {
          await tx.radiologyPanelTest.updateMany({
            where: { labPanelId, tenantId: null, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createTests(tx, null, null, labPanelId, tests);
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.panelName ?? '', dto.panelCode ?? '');
      throw e;
    }
    return this.findTemplateById(labPanelId);
  }

  /**
   * Soft-delete a SITE_ADMIN template radiology panel and cascade soft-delete its
   * included tests, in one transaction.
   * @param labPanelId template id
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/not a template
   */
  async removeTemplate(labPanelId: string): Promise<RadiologyPanel> {
    await this.findCoreTemplateById(labPanelId);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.radiologyPanelTest.updateMany({
        where: { labPanelId, tenantId: null, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.radiologyPanel.update({
        where: { id: labPanelId },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Clone a SITE_ADMIN template radiology panel into a tenant's catalogue. The
   * template's referenced SITE_ADMIN tests are cloned into the tenant FIRST
   * (deduplicated within the request) so the new panel references tenant-owned
   * tests. The whole operation is one transaction.
   * @param templateId the SITE_ADMIN template panel to clone
   * @param tenantId caller's tenant
   * @param masterDataId target master data (validated against the tenant)
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
      newId = await this.prisma.withTenant(tenantId, async (tx) => {
        const templateTests = await tx.radiologyPanelTest.findMany({
          where: { labPanelId: templateId, tenantId: null, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        });
        const panel = await tx.radiologyPanel.create({
          data: {
            ...this.stripMeta(template),
            tenantId,
            branchId: masterData.branchId,
            masterDataId,
            source: DataSource.TENANT,
          } as Prisma.RadiologyPanelUncheckedCreateInput,
        });

        const clonedTestIds = new Map<string, string>();
        const joinRows: {
          labTestId: string;
          sortOrder: number;
          isRemovable: boolean;
          discountPercent: number | null;
        }[] = [];
        for (const t of templateTests) {
          let newTestId = clonedTestIds.get(t.labTestId);
          if (!newTestId) {
            const cloned =
              await this.radiologyTestService.cloneTemplateTestWithinTx(
                tx,
                t.labTestId,
                { tenantId, branchId: masterData.branchId, masterDataId },
              );
            newTestId = cloned.id;
            clonedTestIds.set(t.labTestId, newTestId);
          }
          joinRows.push({
            labTestId: newTestId,
            sortOrder: t.sortOrder,
            isRemovable: t.isRemovable,
            discountPercent: t.discountPercent,
          });
        }
        if (joinRows.length) {
          await tx.radiologyPanelTest.createMany({
            data: joinRows.map((r) => ({
              ...r,
              tenantId,
              branchId: masterData.branchId,
              labPanelId: panel.id,
            })),
          });
        }
        return panel.id;
      });
    } catch (e) {
      this.rethrowConflict(e, template.panelName, template.panelCode);
      throw e;
    }
    return this.findById(masterDataId, newId, tenantId);
  }

  /**
   * Orchestrate the **Tenant Master Data → Branch Master Data** sync ("Import
   * Master Data"). Resolves both master datas (get-or-create), then in ONE
   * transaction syncs radiology tests (building a `tenantTestId → branchLabTestId`
   * map) and panels (remapping membership through that map). All or nothing.
   * @param tenantId tenant scope
   * @param branchId the target branch (from the JWT)
   * @param actorId person recorded on version bumps (or null)
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
          panels: {
            created: p.created,
            updated: p.updated,
            deleted: p.deleted,
          },
        };
      },
      { timeout: 300_000, maxWait: 15_000 },
    );
  }

  /**
   * Sync (update-or-create-or-delete) all active panels from a Tenant Master Data
   * into a Branch Master Data, keyed on `sourceMasterLabPanelId` (falling back to
   * `panelCode`). Membership `labTestId`s are remapped through `testIdMap` to the
   * branch test copies; members with no mapping are dropped. Runs inside the
   * caller's tx.
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
      if (p.sourceMasterLabPanelId) bySource.set(p.sourceMasterLabPanelId, p);
      byCode.set(p.panelCode, p);
    }
    const sourcePanelIds = new Set(sourcePanels.map((p) => p.id));

    let created = 0;
    let updated = 0;
    for (const src of sourcePanels) {
      const members = await tx.radiologyPanelTest.findMany({
        where: { labPanelId: src.id, tenantId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      const joinRows = members
        .map((m) => ({
          labTestId: testIdMap.get(m.labTestId),
          sortOrder: m.sortOrder,
          isRemovable: m.isRemovable,
        }))
        .filter(
          (
            r,
          ): r is {
            labTestId: string;
            sortOrder: number;
            isRemovable: boolean;
          } => Boolean(r.labTestId),
        );

      const target = bySource.get(src.id) ?? byCode.get(src.panelCode);
      let labPanelId: string;
      if (target) {
        await tx.radiologyPanel.update({
          where: { id: target.id },
          data: {
            ...this.stripMeta(src),
            sourceMasterLabPanelId: src.id,
          },
        });
        await tx.radiologyPanelTest.deleteMany({
          where: { labPanelId: target.id, tenantId },
        });
        labPanelId = target.id;
        updated += 1;
      } else {
        const panel = await tx.radiologyPanel.create({
          data: {
            ...this.stripMeta(src),
            tenantId,
            branchId,
            masterDataId: branchMasterDataId,
            source: DataSource.TENANT,
            sourceMasterLabPanelId: src.id,
          } as Prisma.RadiologyPanelUncheckedCreateInput,
        });
        labPanelId = panel.id;
        created += 1;
      }
      if (joinRows.length) {
        await tx.radiologyPanelTest.createMany({
          data: joinRows.map((r) => ({
            ...r,
            tenantId,
            branchId,
            labPanelId,
          })),
        });
      }
    }

    const orphanPanels = branchPanels.filter(
      (p) =>
        p.sourceMasterLabPanelId !== null &&
        !sourcePanelIds.has(p.sourceMasterLabPanelId),
    );
    const now = new Date();
    let deleted = 0;
    for (const orphan of orphanPanels) {
      await this.cascadeDeletePanel(tx, orphan.id, tenantId, now);
      deleted += 1;
    }
    if (orphanPanels.length) {
      await this.cascadeDeleteBranchRadiologyPanelCopies(
        tx,
        tenantId,
        branchId,
        orphanPanels.map((p) => p.id),
        now,
      );
    }

    return { created, updated, deleted };
  }

  /**
   * Soft-delete the branch's operational `BranchRadiologyPanel` copies whose
   * `sourceLabPanelId` points at a Branch Master Data panel just soft-deleted as an
   * orphan — cascading to their `BranchRadiologyPanelTest` join rows. Scoped to the
   * branch's default (Walk-in) panel list; excludes user duplicates. Promotes a
   * remaining sibling to default when needed. Runs inside the caller's tx.
   */
  private async cascadeDeleteBranchRadiologyPanelCopies(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    orphanSourceIds: string[],
    now: Date,
  ): Promise<void> {
    const walkInPanel = await tx.branchRadiologyPanelList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    if (!walkInPanel) {
      return;
    }
    const copies = await tx.branchRadiologyPanel.findMany({
      where: {
        tenantId,
        branchId,
        listId: walkInPanel.id,
        deletedAt: null,
        isDuplicate: false,
        sourceLabPanelId: { in: orphanSourceIds },
      },
      select: { id: true, isDefault: true, sourceLabPanelId: true },
    });
    for (const copy of copies) {
      await tx.branchRadiologyPanelTest.updateMany({
        where: { branchLabPanelId: copy.id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.branchRadiologyPanel.update({
        where: { id: copy.id },
        data: { deletedAt: now },
      });
      if (copy.isDefault && copy.sourceLabPanelId) {
        const sibling = await tx.branchRadiologyPanel.findFirst({
          where: {
            tenantId,
            branchId,
            sourceLabPanelId: copy.sourceLabPanelId,
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
  }

  /**
   * Fetch one active SITE_ADMIN template radiology panel (core row only).
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/not a template
   */
  private async findCoreTemplateById(
    labPanelId: string,
  ): Promise<RadiologyPanel> {
    const panel = await this.prisma.radiologyPanel.findFirst({
      where: { id: labPanelId, source: DataSource.SITE_ADMIN, deletedAt: null },
    });
    if (!panel) {
      throw new RadiologyPanelNotFoundException(labPanelId);
    }
    return panel;
  }

  /**
   * Validate that every `labTestId` references an active SITE_ADMIN template radiology
   * test, with no duplicates within the panel.
   * @throws ValidationException on duplicate test references
   * @throws RadiologyPanelTestNotFoundException on missing/non-template test references
   */
  private async assertTemplateTestRefs(
    tests: RadiologyPanelTestDto[],
  ): Promise<void> {
    if (!tests.length) {
      return;
    }
    const ids = tests.map((t) => t.labTestId);
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
      const cap = capById.get(test.labTestId) ?? 0;
      if (test.discountPercent > cap) {
        throw new ValidationException(
          `discountPercent (${test.discountPercent}) exceeds this test's discount cap (${cap})`,
        );
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Project a page of panels into listing rows: the full panel enriched with its
   * `category`/`department` objects plus the count of included tests.
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
   * Fetch one active radiology panel (core row only) scoped to its tenant + master data.
   * @throws RadiologyPanelNotFoundException if missing/soft-deleted/other master data
   */
  private async findCoreById(
    labPanelId: string,
    masterDataId: string,
    tenantId: string,
  ): Promise<RadiologyPanel> {
    const panel = await this.prisma.radiologyPanel.findFirst({
      where: { id: labPanelId, masterDataId, tenantId, deletedAt: null },
    });
    if (!panel) {
      throw new RadiologyPanelNotFoundException(labPanelId);
    }
    return panel;
  }

  /**
   * Insert a panel's included-test rows (no-op for an empty/absent list).
   * `tenantId` / `branchId` are NULL when the parent panel is a SITE_ADMIN template.
   */
  private async createTests(
    tx: Prisma.TransactionClient,
    tenantId: string | null,
    branchId: string | null,
    labPanelId: string,
    tests: RadiologyPanelTestDto[],
  ): Promise<void> {
    if (!tests.length) {
      return;
    }
    await tx.radiologyPanelTest.createMany({
      data: tests.map((t) => ({ ...t, tenantId, branchId, labPanelId })),
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
   * Validate that every `labTestId` references an active radiology test in the same
   * master data, that there are no duplicates, and that each test's
   * `discountPercent` (if set) doesn't exceed that test's own `discountCapPct`.
   * @throws ValidationException / RadiologyPanelTestNotFoundException
   */
  private async assertTestRefs(
    masterDataId: string,
    tenantId: string,
    tests: RadiologyPanelTestDto[],
  ): Promise<void> {
    if (!tests.length) {
      return;
    }
    const ids = tests.map((t) => t.labTestId);
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
      const cap = capById.get(test.labTestId) ?? 0;
      if (test.discountPercent > cap) {
        throw new ValidationException(
          `discountPercent (${test.discountPercent}) exceeds this test's discount cap (${cap})`,
        );
      }
    }
  }

  /**
   * Enrich a page of panels with their resolved `category`/`department` objects.
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
   * Resolve a set of classification ids to an `id → { id, name }` map (tenant-scoped).
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
   * display/pricing details (batched, no N+1). `labTestId` is a logical reference, so
   * a test that no longer resolves falls back to `null` fields rather than dropping
   * the row.
   */
  private async attachTestDetails(
    tenantId: string | null,
    tests: RadiologyPanelTest[],
  ): Promise<RadiologyPanelTestWithDetails[]> {
    if (tests.length === 0) {
      return [];
    }
    const ids = [...new Set(tests.map((t) => t.labTestId))];
    const [radiologyTests, samples] = await Promise.all([
      this.prisma.radiologyTest.findMany({
        where: { id: { in: ids }, tenantId },
        select: {
          id: true,
          testName: true,
          testCode: true,
          priceMsrp: true,
          priceOriginal: true,
          priceMinimum: true,
          priceMaximum: true,
          discountCapPct: true,
        },
      }),
      this.prisma.radiologyTestSample.findMany({
        where: { labTestId: { in: ids }, tenantId, deletedAt: null },
        orderBy: { isDefault: 'desc' },
        select: { labTestId: true, sampleType: true },
      }),
    ]);
    const testMap = new Map(radiologyTests.map((r) => [r.id, r]));
    const sampleMap = new Map<string, string | null>();
    for (const s of samples) {
      if (!sampleMap.has(s.labTestId)) {
        sampleMap.set(s.labTestId, s.sampleType);
      }
    }
    return tests.map((t) => {
      const src = testMap.get(t.labTestId);
      return {
        ...t,
        testName: src?.testName ?? null,
        testCode: src?.testCode ?? null,
        sampleType: sampleMap.get(t.labTestId) ?? null,
        priceMsrp: src?.priceMsrp ?? null,
        priceOriginal: src?.priceOriginal ?? null,
        priceMinimum: src?.priceMinimum ?? null,
        priceMaximum: src?.priceMaximum ?? null,
        discountCapPct: src?.discountCapPct ?? null,
      };
    });
  }

  /**
   * Count active included tests per panel, keyed by `labPanelId`. `tenantId` is NULL
   * when counting tests of SITE_ADMIN template panels.
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
      by: ['labPanelId'],
      where: { labPanelId: { in: ids }, tenantId, deletedAt: null },
      _count: { _all: true },
    });
    for (const g of grouped) {
      map.set(g.labPanelId, g._count._all);
    }
    return map;
  }

  /** Strip undefined keys from one item's changes, yielding a Prisma update. */
  private pickDefined(
    changes: Omit<BulkEditRadiologyPanelItemDto, 'labPanelId'>,
  ): Prisma.RadiologyPanelUpdateInput {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }

  /** Validate cross-field invariants that class-validator can't express per-field. */
  private assertCoreInvariants(c: PanelInvariants): void {
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
    if (c.maxTestsRemovable > 0 && !c.isAllowPartialBilling) {
      throw new ValidationException(
        'maxTestsRemovable can only be set when isAllowPartialBilling is true',
        { maxTestsRemovable: String(c.maxTestsRemovable) },
      );
    }
    if (c.maxTestsRemovable > c.testsCount) {
      throw new ValidationException(
        'maxTestsRemovable cannot exceed the number of tests in the panel',
        {
          maxTestsRemovable: String(c.maxTestsRemovable),
          testsCount: String(c.testsCount),
        },
      );
    }
  }

  /**
   * Map a Prisma unique-constraint violation (P2002) to the matching typed 409.
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
}
