import { Injectable } from '@nestjs/common';
import { DataSource, LabPanel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from '../lab-test/lab-test.service';
import { CreateLabPanelDto } from './dto/create-lab-panel.dto';
import { UpdateLabPanelDto } from './dto/update-lab-panel.dto';
import { ListLabPanelsDto } from './dto/list-lab-panels.dto';
import {
  BulkEditLabPanelItemDto,
  BulkEditLabPanelsDto,
} from './dto/bulk-edit-lab-panels.dto';
import { LabPanelTestDto } from './dto/lab-panel-test.dto';
import {
  ClassificationRef,
  LabPanelListRow,
  LabPanelWithRefs,
  LabPanelWithTests,
} from './entities/lab-panel.entity';
import {
  LabPanelCodeConflictException,
  LabPanelNameConflictException,
  LabPanelNotFoundException,
  LabPanelTestNotFoundException,
} from './exceptions/lab-panel.exceptions';

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
 * Lab-panel configuration management. Tenant-scoped + branch-level; every panel
 * lives inside a master data (`masterDataId`) whose tenant/branch it inherits. A
 * panel groups several lab tests (managed nested via `LabPanelTest`). Prisma-
 * direct; multi-step writes run in `withTenant` transactions. Cross-field
 * invariants are validated here (defence in front of the CHECK constraints in
 * prisma/rls.sql).
 */
@Injectable()
export class LabPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: MasterDataService,
    private readonly labTestService: LabTestService,
  ) {}

  /**
   * Create a lab panel inside a master data, with its included tests. The master
   * data is validated to belong to the caller's tenant (and supplies `branchId`).
   * Every `labTestId` is validated to reference an active lab test in the same
   * master data. All inserts run in one transaction.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param dto validated payload
   * @returns the created lab panel with its tests
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws ValidationException on a cross-field invariant violation
   * @throws LabPanelTestNotFoundException if a test reference is invalid
   * @throws LabPanelNameConflictException / LabPanelCodeConflictException
   */
  async create(
    masterDataId: string,
    tenantId: string,
    dto: CreateLabPanelDto,
  ): Promise<LabPanelWithTests> {
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
        const panel = await tx.labPanel.create({
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
   * Fetch one lab panel composed with its included tests (ordered by sortOrder).
   * @param masterDataId parent master data id
   * @param panelId lab panel id
   * @param tenantId tenant scope
   * @throws LabPanelNotFoundException if missing/soft-deleted/other master data
   */
  async findById(
    masterDataId: string,
    panelId: string,
    tenantId: string,
  ): Promise<LabPanelWithTests> {
    const panel = await this.findCoreById(panelId, masterDataId, tenantId);
    const [withRefsList, tests] = await Promise.all([
      this.attachRefs(tenantId, [panel]),
      this.prisma.labPanelTest.findMany({
        where: { labPanelId: panelId, tenantId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const withRefs = withRefsList[0];
    if (!withRefs) {
      throw new LabPanelNotFoundException(panelId);
    }
    return { ...withRefs, tests };
  }

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /lab-panels/options`). Tenant-scoped to active, non-deleted lab panels;
   * optionally filtered by `branchId` and a case-insensitive `panelName` search.
   * Returns the full array when `page` is omitted, or a paginated envelope when
   * `page` is supplied (mirrors `BranchService.findOptionsForTenant`).
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
    const where: Prisma.LabPanelWhereInput = {
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
      const rows = await this.prisma.labPanel.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.panelName }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.labPanel.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.labPanel.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.panelName })),
      total,
      page,
      limit,
    };
  }

  /**
   * List active lab panels in a master data (offset pagination; core rows only).
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
  ): Promise<PaginatedResult<LabPanelWithRefs>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const where = { masterDataId, tenantId, deletedAt: null };
    const panels = await this.prisma.labPanel.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
    const total = await this.prisma.labPanel.count({ where });
    const data = await this.attachRefs(tenantId, panels);
    return { data, total, page, limit };
  }

  /**
   * List lab panels in a master data for the listing screen: search by
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
    query: ListLabPanelsDto,
  ): Promise<PaginatedResult<LabPanelListRow>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.LabPanelWhereInput = {
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

    const [panels, total] = await Promise.all([
      this.prisma.labPanel.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.labPanel.count({ where }),
    ]);

    const data = await this.projectListRows(tenantId, panels);
    return { data, total, page, limit };
  }

  /**
   * Update a lab panel. Core fields are patched; when `tests` is provided, the
   * whole included-test set is replaced (old active rows soft-deleted, the new set
   * created) in one transaction.
   * @param masterDataId parent master data id
   * @param panelId lab panel id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws LabPanelNotFoundException / ValidationException / conflict exceptions
   * @throws LabPanelTestNotFoundException if a test reference is invalid
   */
  async update(
    masterDataId: string,
    panelId: string,
    tenantId: string,
    dto: UpdateLabPanelDto,
  ): Promise<LabPanelWithTests> {
    const existing = await this.findCoreById(panelId, masterDataId, tenantId);

    // Effective test count after this update: the replacement set if provided,
    // else the current active count.
    const testsCount =
      dto.tests !== undefined
        ? dto.tests.length
        : await this.prisma.labPanelTest.count({
            where: { labPanelId: panelId, tenantId, deletedAt: null },
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
        await tx.labPanel.update({ where: { id: panelId }, data: scalars });
        if (tests !== undefined) {
          await tx.labPanelTest.updateMany({
            where: { labPanelId: panelId, tenantId, deletedAt: null },
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
   * Bulk-edit lab panels: apply each item's scalar changes to its own
   * `labPanelId` (all scoped to the caller's tenant + the path's master data).
   * All-or-nothing — every item is validated up front (against the panel's
   * existing values + test count) and the updates run in one transaction, so if
   * any item is invalid or its `labPanelId` can't be resolved nothing changes.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param dto the array of per-panel edits
   * @returns the number of panels updated
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws ValidationException on duplicate ids, an empty item, or a broken invariant
   * @throws LabPanelNotFoundException if a `labPanelId` doesn't resolve to an active panel
   */
  async bulkEdit(
    masterDataId: string,
    tenantId: string,
    dto: BulkEditLabPanelsDto,
  ): Promise<BulkEditResult> {
    await this.masterDataService.findById(masterDataId, tenantId);

    const items = dto.data;
    const ids = items.map((i) => i.labPanelId);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationException('Duplicate labPanelId in payload');
    }

    // Split each item into its target id + the (defined) fields to change.
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

    const panels = await this.prisma.labPanel.findMany({
      where: { id: { in: ids }, masterDataId, tenantId, deletedAt: null },
    });
    const panelById = new Map(panels.map((p) => [p.id, p]));
    const missing = ids.find((id) => !panelById.has(id));
    if (missing) {
      throw new LabPanelNotFoundException(missing);
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
        await tx.labPanel.update({ where: { id: labPanelId }, data });
      }
    });
    return { updated: edits.length };
  }

  /**
   * Soft-delete a lab panel and cascade soft-delete its included tests in one
   * transaction.
   * @param masterDataId parent master data id
   * @param panelId lab panel id
   * @param tenantId tenant scope
   * @throws LabPanelNotFoundException if missing/soft-deleted/other master data
   */
  async remove(
    masterDataId: string,
    panelId: string,
    tenantId: string,
  ): Promise<LabPanel> {
    await this.findCoreById(panelId, masterDataId, tenantId);
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.labPanelTest.updateMany({
        where: { labPanelId: panelId, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.labPanel.update({
        where: { id: panelId },
        data: { deletedAt: now },
      });
    });
  }

  // ── Site Admin global templates ─────────────────────────────────────────────────

  /**
   * Create a SITE_ADMIN global template lab panel (no tenant/branch/master data).
   * Reuses `CreateLabPanelDto` but forces the (tenant-scoped) category/department
   * refs NULL. Every included `labTestId` must reference an active SITE_ADMIN
   * template lab test. Runs in a plain transaction (no tenant GUC).
   * @param dto validated payload (classification refs ignored)
   * @throws ValidationException on a cross-field invariant violation
   * @throws LabPanelTestNotFoundException if a test reference isn't a live template test
   * @throws LabPanelNameConflictException / LabPanelCodeConflictException
   */
  async createTemplate(dto: CreateLabPanelDto): Promise<LabPanelWithTests> {
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
        const panel = await tx.labPanel.create({
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
   * List SITE_ADMIN template lab panels (with test counts; no tenant
   * classification refs). Supports `search` and `status` → `isActive`.
   * @param query search + status + pagination
   */
  async findAllTemplates(
    query: ListLabPanelsDto,
  ): Promise<PaginatedResult<LabPanelListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.LabPanelWhereInput = {
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
      this.prisma.labPanel.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.labPanel.count({ where }),
    ]);
    const counts = await this.countTestsByPanel(
      null,
      panels.map((p) => p.id),
    );
    const data: LabPanelListRow[] = panels.map((p) => ({
      ...p,
      category: null,
      department: null,
      testsCount: counts.get(p.id) ?? 0,
    }));
    return { data, total, page, limit };
  }

  /**
   * Fetch one SITE_ADMIN template lab panel composed with its included tests.
   * @param panelId template id
   * @throws LabPanelNotFoundException if missing/soft-deleted/not a template
   */
  async findTemplateById(panelId: string): Promise<LabPanelWithTests> {
    const panel = await this.findCoreTemplateById(panelId);
    const tests = await this.prisma.labPanelTest.findMany({
      where: { labPanelId: panelId, tenantId: null, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return { ...panel, category: null, department: null, tests };
  }

  /**
   * Update a SITE_ADMIN template lab panel (same test-replacement semantics as
   * `update`). Classification refs stay NULL; replacement tests must be SITE_ADMIN
   * template tests. Runs in a plain transaction.
   * @param panelId template id
   * @param dto partial update (classification refs ignored)
   * @throws LabPanelNotFoundException / ValidationException / conflict exceptions
   * @throws LabPanelTestNotFoundException if a test reference isn't a live template test
   */
  async updateTemplate(
    panelId: string,
    dto: UpdateLabPanelDto,
  ): Promise<LabPanelWithTests> {
    const existing = await this.findCoreTemplateById(panelId);
    const testsCount =
      dto.tests !== undefined
        ? dto.tests.length
        : await this.prisma.labPanelTest.count({
            where: { labPanelId: panelId, tenantId: null, deletedAt: null },
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
        await tx.labPanel.update({
          where: { id: panelId },
          data: { ...scalars, categoryId: null, departmentId: null },
        });
        if (tests !== undefined) {
          await tx.labPanelTest.updateMany({
            where: { labPanelId: panelId, tenantId: null, deletedAt: null },
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
   * Soft-delete a SITE_ADMIN template lab panel and cascade soft-delete its
   * included tests, in one transaction.
   * @param panelId template id
   * @throws LabPanelNotFoundException if missing/soft-deleted/not a template
   */
  async removeTemplate(panelId: string): Promise<LabPanel> {
    await this.findCoreTemplateById(panelId);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.labPanelTest.updateMany({
        where: { labPanelId: panelId, tenantId: null, deletedAt: null },
        data: { deletedAt: now },
      });
      return tx.labPanel.update({
        where: { id: panelId },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Clone a SITE_ADMIN template lab panel into a tenant's catalogue (business-user
   * flow). `tenantId` comes from the caller's JWT; `branchId` from the target
   * master data; only `masterDataId` is client-supplied. The template's referenced
   * SITE_ADMIN lab tests are cloned into the tenant FIRST (deduplicated within the
   * request) so the new panel references tenant-owned tests, not the templates.
   * The whole operation — panel, cloned tests, and join rows — is one transaction.
   * @param templateId the SITE_ADMIN template panel to clone
   * @param tenantId caller's tenant
   * @param masterDataId target master data (validated against the tenant)
   * @returns the newly-created tenant lab panel with its tests
   * @throws LabPanelNotFoundException if `templateId` is not a live template
   * @throws LabTestNotFoundException if a referenced template test is missing
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws LabPanelNameConflictException / LabPanelCodeConflictException on a clash
   */
  async cloneToTenant(
    templateId: string,
    tenantId: string,
    masterDataId: string,
  ): Promise<LabPanelWithTests> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );
    const template = await this.findCoreTemplateById(templateId);
    let newId: string;
    try {
      newId = await this.prisma.withTenant(tenantId, async (tx) => {
        const templateTests = await tx.labPanelTest.findMany({
          where: { labPanelId: templateId, tenantId: null, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        });
        const panel = await tx.labPanel.create({
          data: {
            ...this.stripMeta(template),
            tenantId,
            branchId: masterData.branchId,
            masterDataId,
            source: DataSource.TENANT,
          } as Prisma.LabPanelUncheckedCreateInput,
        });

        // Clone each referenced template test into the tenant once, remapping the
        // join rows to the new tenant test ids.
        const clonedTestIds = new Map<string, string>();
        const joinRows: {
          labTestId: string;
          sortOrder: number;
          isRemovable: boolean;
        }[] = [];
        for (const t of templateTests) {
          let newTestId = clonedTestIds.get(t.labTestId);
          if (!newTestId) {
            const cloned = await this.labTestService.cloneTemplateTestWithinTx(
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
          });
        }
        if (joinRows.length) {
          await tx.labPanelTest.createMany({
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
   * Fetch one active SITE_ADMIN template lab panel (core row only).
   * @throws LabPanelNotFoundException if missing/soft-deleted/not a template
   */
  private async findCoreTemplateById(panelId: string): Promise<LabPanel> {
    const panel = await this.prisma.labPanel.findFirst({
      where: { id: panelId, source: DataSource.SITE_ADMIN, deletedAt: null },
    });
    if (!panel) {
      throw new LabPanelNotFoundException(panelId);
    }
    return panel;
  }

  /**
   * Validate that every `labTestId` references an active SITE_ADMIN template lab
   * test, with no duplicates within the panel (template equivalent of
   * `assertTestRefs`, which is scoped to a tenant master data).
   * @throws ValidationException on duplicate test references
   * @throws LabPanelTestNotFoundException on missing/non-template test references
   */
  private async assertTemplateTestRefs(
    tests: LabPanelTestDto[],
  ): Promise<void> {
    if (!tests.length) {
      return;
    }
    const ids = tests.map((t) => t.labTestId);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new ValidationException('Duplicate test references in panel');
    }
    const found = await this.prisma.labTest.findMany({
      where: {
        id: { in: [...unique] },
        source: DataSource.SITE_ADMIN,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (found.length !== unique.size) {
      const foundIds = new Set(found.map((t) => t.id));
      const missing = [...unique].filter((id) => !foundIds.has(id));
      throw new LabPanelTestNotFoundException(missing);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Project a page of panels into listing rows: the full panel enriched with its
   * `category`/`department` objects plus the count of included tests. Classification
   * refs and counts are batched over the page's ids (no N+1).
   */
  private async projectListRows(
    tenantId: string,
    panels: LabPanel[],
  ): Promise<LabPanelListRow[]> {
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
   * Fetch one active lab panel (core row only) scoped to its tenant + master data.
   * @throws LabPanelNotFoundException if missing/soft-deleted/other master data
   */
  private async findCoreById(
    panelId: string,
    masterDataId: string,
    tenantId: string,
  ): Promise<LabPanel> {
    const panel = await this.prisma.labPanel.findFirst({
      where: { id: panelId, masterDataId, tenantId, deletedAt: null },
    });
    if (!panel) {
      throw new LabPanelNotFoundException(panelId);
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
    tests: LabPanelTestDto[],
  ): Promise<void> {
    if (!tests.length) {
      return;
    }
    await tx.labPanelTest.createMany({
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
   * Validate that every `labTestId` references an active lab test in the same
   * master data, and that there are no duplicates within the panel.
   * @throws ValidationException on duplicate test references
   * @throws LabPanelTestNotFoundException on missing/foreign test references
   */
  private async assertTestRefs(
    masterDataId: string,
    tenantId: string,
    tests: LabPanelTestDto[],
  ): Promise<void> {
    if (!tests.length) {
      return;
    }
    const ids = tests.map((t) => t.labTestId);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      throw new ValidationException('Duplicate test references in panel');
    }
    const found = await this.prisma.labTest.findMany({
      where: {
        id: { in: [...unique] },
        masterDataId,
        tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (found.length !== unique.size) {
      const foundIds = new Set(found.map((t) => t.id));
      const missing = [...unique].filter((id) => !foundIds.has(id));
      throw new LabPanelTestNotFoundException(missing);
    }
  }

  /**
   * Enrich a page of panels with their resolved `category`/`department` objects
   * (`{ id, name }` or `null`). Batches the category + department lookups over the
   * page's ids (no N+1) and maps each panel to a `LabPanelWithRefs`.
   */
  private async attachRefs(
    tenantId: string,
    panels: LabPanel[],
  ): Promise<LabPanelWithRefs[]> {
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
   * Count active included tests per panel, keyed by `labPanelId`. `tenantId` is
   * NULL when counting tests of SITE_ADMIN template panels.
   */
  private async countTestsByPanel(
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (ids.length === 0) {
      return map;
    }
    const grouped = await this.prisma.labPanelTest.groupBy({
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
    changes: Omit<BulkEditLabPanelItemDto, 'labPanelId'>,
  ): Prisma.LabPanelUpdateInput {
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
      throw new LabPanelCodeConflictException(panelCode);
    }
    throw new LabPanelNameConflictException(panelName);
  }
}
