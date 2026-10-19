import { Injectable } from '@nestjs/common';
import { DataSource, Prisma, RadiologyTest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import {
  KaltrosException,
  ValidationException,
} from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { CreateRadiologyTestDto } from './dto/create-radiology-test.dto';
import { UpdateRadiologyTestDto } from './dto/update-radiology-test.dto';
import {
  BrowseRadiologyTestTemplatesDto,
  ListRadiologyTestsDto,
} from './dto/list-radiology-tests.dto';
import { ImportRadiologyTestTemplatesDto } from './dto/import-radiology-test-templates.dto';
import { SyncRadiologyTestTemplatesDto } from './dto/sync-radiology-test-templates.dto';
import {
  ImportableRadiologyTemplateRow,
  RadiologyTestCloneResult,
  RadiologyTestImportResult,
  RadiologyTestListRow,
  RadiologyTestListView,
  RadiologyTestSyncResult,
  RadiologyTestVersionEntry,
} from './entities/radiology-test.entity';
import {
  RadiologyTestCodeConflictException,
  RadiologyTestNameConflictException,
  RadiologyTestNotFoundException,
} from './exceptions/radiology-test.exceptions';

/**
 * Row keys that are re-derived (never copied) when cloning a radiology test.
 */
const META_KEYS = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'source',
  'clonedFromId',
  'templateSyncedAt',
  'sourceMasterRadiologyTestId',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'versionHistory',
];

/**
 * Classification refs that are real FKs to tenant-scoped catalogue tables. A
 * SITE_ADMIN global template belongs to no tenant, so it cannot reference them —
 * they are forced NULL when creating/updating a template.
 */
const TEMPLATE_NULLED_REFS = {
  departmentId: null,
  categoryId: null,
  subCategoryId: null,
} as const;

/**
 * Radiology-test configuration management. Tenant-scoped + branch-level; every
 * test lives inside a master data (`masterDataId`) whose tenant/branch it
 * inherits. The radiology model is FLAT (no samples/result-params/reference
 * ranges), so this service mirrors `LabTestService` for the CRUD, SITE_ADMIN
 * template, clone, import and sync flows only. Prisma-direct; multi-step writes
 * run in `withTenant` transactions. Price ordering is validated here (defence in
 * front of the CHECK constraints in prisma/rls.sql).
 */
@Injectable()
export class RadiologyTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: MasterDataService,
  ) {}

  /**
   * Create a radiology test inside a master data. The master data is validated to
   * belong to the caller's tenant (and supplies `branchId`). Seeds
   * `versionHistory` with v1.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param actorId person id recorded as `modifiedBy` on the seeded v1
   * @param dto validated payload
   * @returns the created radiology test
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws ValidationException on a price-ordering violation
   * @throws RadiologyTestNameConflictException / RadiologyTestCodeConflictException
   */
  async create(
    masterDataId: string,
    tenantId: string,
    actorId: string | null,
    dto: CreateRadiologyTestDto,
  ): Promise<RadiologyTest> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? 0,
      priceMaximum: dto.priceMaximum ?? 0,
      priceMinimum: dto.priceMinimum ?? 0,
    });
    await this.assertCatalogueRefs(tenantId, {
      departmentId: dto.departmentId,
      categoryId: dto.categoryId,
      subCategoryId: dto.subCategoryId,
    });

    try {
      return await this.prisma.withTenant(tenantId, (tx) =>
        tx.radiologyTest.create({
          data: {
            ...dto,
            tenantId,
            branchId: masterData.branchId,
            masterDataId,
            versionHistory: [
              this.seedVersion(actorId),
            ] as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    } catch (e) {
      this.rethrowConflict(e, dto.testName, dto.testCode);
      throw e;
    }
  }

  /**
   * Fetch one radiology test scoped to its tenant + master data.
   * @param masterDataId parent master data id
   * @param radiologyTestId radiology test id
   * @param tenantId tenant scope
   * @throws RadiologyTestNotFoundException if missing/soft-deleted/other master data
   */
  async findById(
    masterDataId: string,
    radiologyTestId: string,
    tenantId: string,
  ): Promise<RadiologyTest> {
    return this.findCoreById(radiologyTestId, masterDataId, tenantId);
  }

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /radiology-tests/options`). Tenant-scoped to active, non-deleted
   * radiology tests; optionally filtered by `branchId` and a case-insensitive
   * `testName` search. Returns the full array when `page` is omitted, or a
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
    const where: Prisma.RadiologyTestWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
    };
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    const search = filters.search?.trim();
    if (search) {
      where.testName = { contains: search, mode: 'insensitive' };
    }

    const select = { id: true, testName: true } as const;
    const orderBy = { testName: 'asc' } as const;

    if (filters.page === undefined) {
      const rows = await this.prisma.radiologyTest.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.testName }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.radiologyTest.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.radiologyTest.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.testName })),
      total,
      page,
      limit,
    };
  }

  /**
   * List active radiology tests in a master data (offset pagination; full rows).
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param query pagination + filters
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async findAll(
    masterDataId: string,
    tenantId: string,
    query: ListRadiologyTestsDto = {},
  ): Promise<PaginatedResult<RadiologyTest>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildListWhere(masterDataId, tenantId, query);
    const [data, total] = await Promise.all([
      this.prisma.radiologyTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.radiologyTest.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * List radiology tests in a master data for the configurable listing screen.
   * Supports search (by `testName`/`testCode`), modality + classification +
   * status filters, and a `view` that projects a different column subset.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param query view + filters + pagination
   * @returns a paginated list of view-specific projection rows
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async listForView(
    masterDataId: string,
    tenantId: string,
    query: ListRadiologyTestsDto,
  ): Promise<PaginatedResult<RadiologyTestListRow>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const view = query.view ?? RadiologyTestListView.DEFAULT;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = this.buildListWhere(masterDataId, tenantId, query);
    const orderBy = this.buildListOrderBy(query.sortBy, query.sortOrder);

    const [tests, total] = await Promise.all([
      this.prisma.radiologyTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      this.prisma.radiologyTest.count({ where }),
    ]);

    const data = await this.projectListRows(view, tenantId, tests);
    return { data, total, page, limit };
  }

  /**
   * Build the shared `where` clause for the list/listing endpoints: tenant +
   * master-data scope, `search` (testName/testCode), modality + classification
   * filters, and `status` → `isActive`.
   */
  private buildListWhere(
    masterDataId: string,
    tenantId: string,
    query: ListRadiologyTestsDto,
  ): Prisma.RadiologyTestWhereInput {
    const where: Prisma.RadiologyTestWhereInput = {
      masterDataId,
      tenantId,
      deletedAt: null,
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { testName: { contains: search, mode: 'insensitive' } },
        { testCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.modality) where.modality = query.modality;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.subCategoryId) where.subCategoryId = query.subCategoryId;
    if (query.status) where.isActive = query.status === 'ACTIVE';
    return where;
  }

  /**
   * Resolve a listing `sortBy`/`sortOrder` (`1` asc / `-1` desc) into a Prisma
   * `orderBy`. Falls back to `createdAt desc` when no sort is requested. All
   * sortable columns are scalar on the flat model (no relation/derived sorts).
   */
  private buildListOrderBy(
    sortBy: ListRadiologyTestsDto['sortBy'],
    sortOrder: ListRadiologyTestsDto['sortOrder'],
  ): Prisma.RadiologyTestOrderByWithRelationInput {
    const dir: 'asc' | 'desc' = sortOrder === -1 ? 'desc' : 'asc';
    if (!sortBy) {
      return { createdAt: 'desc' };
    }
    return { [sortBy]: dir };
  }

  /** Project a page of radiology tests into the requested listing-view shape. */
  private async projectListRows(
    view: RadiologyTestListView,
    tenantId: string | null,
    tests: RadiologyTest[],
  ): Promise<RadiologyTestListRow[]> {
    if (tests.length === 0) {
      return [];
    }

    switch (view) {
      case RadiologyTestListView.DEFAULT: {
        const deptNames = await this.resolveNames(
          'department',
          tenantId,
          tests.map((t) => t.departmentId),
        );
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          testCode: t.testCode,
          modality: t.modality,
          bodyPart: t.bodyPart,
          departmentName: this.nameOf(deptNames, t.departmentId),
          priceMsrp: t.priceMsrp,
          tatMaxValue: t.tatMaxValue,
          tatMaxUnit: t.tatMaxUnit,
          isActive: t.isActive,
        }));
      }

      case RadiologyTestListView.BASIC_DETAILS: {
        const [deptNames, catNames, subCatNames] = await Promise.all([
          this.resolveNames(
            'department',
            tenantId,
            tests.map((t) => t.departmentId),
          ),
          this.resolveNames(
            'category',
            tenantId,
            tests.map((t) => t.categoryId),
          ),
          this.resolveNames(
            'subCategory',
            tenantId,
            tests.map((t) => t.subCategoryId),
          ),
        ]);
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          testCode: t.testCode,
          aka: t.aka,
          modality: t.modality,
          bodyPart: t.bodyPart,
          view: t.view,
          isContrast: t.isContrast,
          departmentName: this.nameOf(deptNames, t.departmentId),
          categoryName: this.nameOf(catNames, t.categoryId),
          subCategoryName: this.nameOf(subCatNames, t.subCategoryId),
          icdCode: t.icdCode,
          loincCode: t.loincCode,
        }));
      }

      case RadiologyTestListView.PRICING:
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          testCode: t.testCode,
          priceMsrp: t.priceMsrp,
          priceMinimum: t.priceMinimum,
          priceMaximum: t.priceMaximum,
          priceOriginal: t.priceOriginal,
          franchisePrice: t.franchisePrice,
          emergencyPrice: t.emergencyPrice,
          discountCapPct: t.discountCapPct,
          isAllowPriceOverride: t.isAllowPriceOverride,
          isAllowDiscounts: t.isAllowDiscounts,
        }));

      case RadiologyTestListView.TAT:
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          tatMinValue: t.tatMinValue,
          tatMinUnit: t.tatMinUnit,
          tatMaxValue: t.tatMaxValue,
          tatMaxUnit: t.tatMaxUnit,
          scheduleFrom: t.scheduleFrom,
          scheduleTo: t.scheduleTo,
        }));

      case RadiologyTestListView.FLAGS:
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          isHideInOrderScreen: t.isHideInOrderScreen,
          isEnableCms: t.isEnableCms,
          isPreferenceTest: t.isPreferenceTest,
          isOutsource: t.isOutsource,
          isBillOnlyTest: t.isBillOnlyTest,
          isActive: t.isActive,
        }));

      case RadiologyTestListView.NOTES:
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          usefulFor: t.usefulFor,
          interpretationOfResults: t.interpretationOfResults,
          limitations: t.limitations,
          remarks: t.remarks,
          references: t.references,
          preparationInstructions: t.preparationInstructions,
        }));

      case RadiologyTestListView.OVERVIEW: {
        const deptNames = await this.resolveNames(
          'department',
          tenantId,
          tests.map((t) => t.departmentId),
        );
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          testCode: t.testCode,
          modality: t.modality,
          departmentName: this.nameOf(deptNames, t.departmentId),
          maxValue: t.priceMaximum,
          tatMaxValue: t.tatMaxValue,
          tatMaxUnit: t.tatMaxUnit,
          isActive: t.isActive,
        }));
      }
    }
  }

  /**
   * Resolve a set of classification ids to a `id → name` map. Classification
   * tables are tenant-scoped; templates pass `tenantId = null` and carry no
   * classification (empty ids → early return).
   */
  private async resolveNames(
    model: 'department' | 'category' | 'subCategory',
    tenantId: string | null,
    idsRaw: (string | null)[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(idsRaw.filter((x): x is string => Boolean(x)))];
    const map = new Map<string, string>();
    if (ids.length === 0) {
      return map;
    }
    const where = { id: { in: ids }, tenantId: tenantId ?? undefined };
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
   * Update a radiology test's scalar fields. Validates price ordering against the
   * merged values before writing.
   * @param masterDataId parent master data id
   * @param radiologyTestId radiology test id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws RadiologyTestNotFoundException if missing
   * @throws ValidationException on a price-ordering violation
   * @throws RadiologyTestNameConflictException / RadiologyTestCodeConflictException
   */
  async update(
    masterDataId: string,
    radiologyTestId: string,
    tenantId: string,
    dto: UpdateRadiologyTestDto,
  ): Promise<RadiologyTest> {
    const existing = await this.findCoreById(
      radiologyTestId,
      masterDataId,
      tenantId,
    );
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? existing.priceMsrp,
      priceMaximum: dto.priceMaximum ?? existing.priceMaximum,
      priceMinimum: dto.priceMinimum ?? existing.priceMinimum,
    });
    await this.assertCatalogueRefs(tenantId, {
      departmentId: dto.departmentId,
      categoryId: dto.categoryId,
      subCategoryId: dto.subCategoryId,
    });

    try {
      return await this.prisma.withTenant(tenantId, (tx) =>
        tx.radiologyTest.update({
          where: { id: radiologyTestId },
          data: dto,
        }),
      );
    } catch (e) {
      this.rethrowConflict(e, dto.testName ?? '', dto.testCode ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a radiology test.
   * @param masterDataId parent master data id
   * @param radiologyTestId radiology test id
   * @param tenantId tenant scope
   * @throws RadiologyTestNotFoundException if missing/soft-deleted/other master data
   */
  async remove(
    masterDataId: string,
    radiologyTestId: string,
    tenantId: string,
  ): Promise<RadiologyTest> {
    await this.findCoreById(radiologyTestId, masterDataId, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.radiologyTest.update({
        where: { id: radiologyTestId },
        data: { deletedAt: new Date() },
      }),
    );
  }

  /**
   * Clone all active radiology tests from a source master data into a target
   * master data (duplicate name/code skipped). Both are validated to belong to
   * the caller's tenant.
   * @param sourceMasterDataId source master data (the `:masterDataId` path param)
   * @param targetMasterDataId target master data
   * @param tenantId tenant scope
   * @returns `{ copied, skipped }`
   */
  async cloneAll(
    sourceMasterDataId: string,
    targetMasterDataId: string,
    tenantId: string,
  ): Promise<RadiologyTestCloneResult> {
    await this.masterDataService.findById(sourceMasterDataId, tenantId);
    const target = await this.masterDataService.findById(
      targetMasterDataId,
      tenantId,
    );
    return this.prisma.withTenant(tenantId, async (tx) => {
      const sourceTests = await tx.radiologyTest.findMany({
        where: { masterDataId: sourceMasterDataId, tenantId, deletedAt: null },
      });
      const existing = await tx.radiologyTest.findMany({
        where: { masterDataId: targetMasterDataId, tenantId, deletedAt: null },
        select: { testName: true, testCode: true },
      });
      const names = new Set(existing.map((t) => t.testName));
      const codes = new Set(existing.map((t) => t.testCode));

      let copied = 0;
      let skipped = 0;
      for (const src of sourceTests) {
        if (names.has(src.testName) || codes.has(src.testCode)) {
          skipped += 1;
          continue;
        }
        await this.clonePersistTest(tx, src, {
          tenantId,
          branchId: target.branchId,
          masterDataId: targetMasterDataId,
          source: DataSource.TENANT,
          actorId: null,
        });
        copied += 1;
      }
      return { copied, skipped };
    });
  }

  // ── SITE_ADMIN templates ──────────────────────────────────────────────────

  /**
   * Create a global template radiology test (`source = SITE_ADMIN`, no
   * tenant/branch/master data; classification refs forced NULL).
   * @param actorId SiteAdmin actor recorded on the seed version (or null)
   * @param dto validated payload
   */
  async createTemplate(
    actorId: string | null,
    dto: CreateRadiologyTestDto,
  ): Promise<RadiologyTest> {
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? 0,
      priceMaximum: dto.priceMaximum ?? 0,
      priceMinimum: dto.priceMinimum ?? 0,
    });
    try {
      return await this.prisma.$transaction((tx) =>
        tx.radiologyTest.create({
          data: {
            ...dto,
            ...TEMPLATE_NULLED_REFS,
            tenantId: null,
            branchId: null,
            masterDataId: null,
            source: DataSource.SITE_ADMIN,
            versionHistory: [
              this.seedVersion(actorId),
            ] as unknown as Prisma.InputJsonValue,
          },
        }),
      );
    } catch (e) {
      this.rethrowConflict(e, dto.testName, dto.testCode);
      throw e;
    }
  }

  /**
   * List SITE_ADMIN template radiology tests for the listing screen. Supports
   * `search` (testName/testCode), `status` → `isActive`, and the same `view`
   * projection as the tenant `listForView` (defaults to DEFAULT). Classification/
   * modality filters don't apply to templates in the same way, but `modality` is
   * still honoured (it is an intrinsic column). When a business caller supplies a
   * `tenantId` + `masterDataId`, each row is annotated with `isImported`.
   * @param query view + search + status + pagination
   * @param tenantId optional business tenant (enables `isImported`)
   */
  async findAllTemplates(
    query: BrowseRadiologyTestTemplatesDto = {},
    tenantId?: string,
  ): Promise<PaginatedResult<ImportableRadiologyTemplateRow>> {
    const view = query.view ?? RadiologyTestListView.DEFAULT;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.RadiologyTestWhereInput = {
      source: DataSource.SITE_ADMIN,
      deletedAt: null,
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { testName: { contains: search, mode: 'insensitive' } },
        { testCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.modality) {
      where.modality = query.modality;
    }
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }

    let importedTemplateIds = new Set<string>();
    if (tenantId && query.masterDataId) {
      await this.masterDataService.findById(query.masterDataId, tenantId);
      const imported = await this.prisma.radiologyTest.findMany({
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
    const [tests, total] = await Promise.all([
      this.prisma.radiologyTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.radiologyTest.count({ where }),
    ]);
    const rows = await this.projectListRows(view, null, tests);
    const data: ImportableRadiologyTemplateRow[] = rows.map((row) => ({
      ...row,
      isImported: importedTemplateIds.has(row.id),
    }));
    return { data, total, page, limit };
  }

  /**
   * Lightweight `{ id, name }` options for SITE_ADMIN template radiology tests
   * (`GET /siteadmin/radiology-tests/options`). Returns the full array when
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
    const where: Prisma.RadiologyTestWhereInput = {
      source: DataSource.SITE_ADMIN,
      tenantId: null,
      deletedAt: null,
      isActive: true,
    };
    const search = filters.search?.trim();
    if (search) {
      where.testName = { contains: search, mode: 'insensitive' };
    }

    const select = { id: true, testName: true } as const;
    const orderBy = { testName: 'asc' } as const;

    if (filters.page === undefined) {
      const rows = await this.prisma.radiologyTest.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.testName }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.radiologyTest.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.radiologyTest.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.testName })),
      total,
      page,
      limit,
    };
  }

  /**
   * Fetch one SITE_ADMIN template radiology test (core row).
   * @param radiologyTestId template id
   * @throws RadiologyTestNotFoundException if missing/soft-deleted/not a template
   */
  async findTemplateById(radiologyTestId: string): Promise<RadiologyTest> {
    return this.findCoreTemplateById(radiologyTestId);
  }

  /**
   * Update a SITE_ADMIN template radiology test. Classification refs stay NULL.
   * @param radiologyTestId template id
   * @param dto partial update (classification refs ignored)
   * @throws RadiologyTestNotFoundException / ValidationException / conflict exceptions
   */
  async updateTemplate(
    radiologyTestId: string,
    dto: UpdateRadiologyTestDto,
  ): Promise<RadiologyTest> {
    const existing = await this.findCoreTemplateById(radiologyTestId);
    this.assertPriceOrdering({
      priceMsrp: dto.priceMsrp ?? existing.priceMsrp,
      priceMaximum: dto.priceMaximum ?? existing.priceMaximum,
      priceMinimum: dto.priceMinimum ?? existing.priceMinimum,
    });
    try {
      return await this.prisma.$transaction((tx) =>
        tx.radiologyTest.update({
          where: { id: radiologyTestId },
          data: { ...dto, ...TEMPLATE_NULLED_REFS },
        }),
      );
    } catch (e) {
      this.rethrowConflict(e, dto.testName ?? '', dto.testCode ?? '');
      throw e;
    }
  }

  /**
   * Soft-delete a SITE_ADMIN template radiology test.
   * @param radiologyTestId template id
   * @throws RadiologyTestNotFoundException if missing/soft-deleted/not a template
   */
  async removeTemplate(radiologyTestId: string): Promise<RadiologyTest> {
    await this.findCoreTemplateById(radiologyTestId);
    return this.prisma.radiologyTest.update({
      where: { id: radiologyTestId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Clone a SITE_ADMIN template radiology test into a tenant's catalogue.
   * `tenantId` comes from the caller's JWT; `branchId` from the target master
   * data; only `masterDataId` is client-supplied (validated to belong to the
   * tenant). The new test is `source = TENANT` with a fresh id and a fresh
   * `versionHistory` v1.
   * @param templateId the SITE_ADMIN template to clone
   * @param tenantId caller's tenant
   * @param masterDataId target master data (validated against the tenant)
   * @throws RadiologyTestNotFoundException if `templateId` is not a live template
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws RadiologyTestNameConflictException / RadiologyTestCodeConflictException
   */
  async cloneToTenant(
    templateId: string,
    tenantId: string,
    masterDataId: string,
  ): Promise<RadiologyTest> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );
    const template = await this.findCoreTemplateById(templateId);
    try {
      return await this.prisma.withTenant(tenantId, (tx) =>
        this.clonePersistTest(tx, template, {
          tenantId,
          branchId: masterData.branchId,
          masterDataId,
          source: DataSource.TENANT,
          actorId: null,
        }),
      );
    } catch (e) {
      this.rethrowConflict(e, template.testName, template.testCode);
      throw e;
    }
  }

  /**
   * Bulk-import SITE_ADMIN template radiology tests into a tenant's master data.
   * Each template is imported in its own transaction so one failure never aborts
   * the batch: already-imported templates (tracked by `clonedFromId`) are
   * skipped, missing/deleted templates and name/code conflicts are reported.
   * @param tenantId tenant scope (from the JWT)
   * @param actorId person recorded on the seed version (or null)
   * @param dto target master data + SITE_ADMIN template ids
   * @returns an `{ imported, skipped, failed }` summary
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async importTemplates(
    tenantId: string,
    actorId: string | null,
    dto: ImportRadiologyTestTemplatesDto,
  ): Promise<RadiologyTestImportResult> {
    const masterData = await this.masterDataService.findById(
      dto.masterDataId,
      tenantId,
    );
    const templates = await this.prisma.radiologyTest.findMany({
      where: {
        id: { in: dto.templateIds },
        source: DataSource.SITE_ADMIN,
        deletedAt: null,
      },
    });
    const templateById = new Map(templates.map((t) => [t.id, t]));
    const already = await this.prisma.radiologyTest.findMany({
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

    const result: RadiologyTestImportResult = {
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
          testName: template.testName,
          reason: 'Already imported into this master data',
        });
        continue;
      }
      try {
        const created = await this.prisma.withTenant(tenantId, (tx) =>
          this.clonePersistTest(tx, template, {
            tenantId,
            branchId: masterData.branchId,
            masterDataId: dto.masterDataId,
            source: DataSource.TENANT,
            actorId,
          }),
        );
        result.imported.push({
          templateId,
          radiologyTestId: created.id,
          testName: template.testName,
        });
      } catch (e) {
        result.failed.push({
          templateId,
          testName: template.testName,
          reason: this.conflictReason(e, template.testName, template.testCode),
        });
      }
    }
    return result;
  }

  /**
   * Re-pull previously-imported radiology tests from their SITE_ADMIN templates.
   * The tenant copy's scalars are replaced from the template (version bumped) and
   * `templateSyncedAt` is stamped; identity/scope/provenance are preserved.
   * Hand-created tests (`clonedFromId = null`) are never touched. Each test is
   * synced in its own transaction so one failure never aborts the batch.
   * @param tenantId tenant scope (from the JWT)
   * @param actorId person recorded on the bumped version (or null)
   * @param dto master data + optional subset of tenant radiology-test ids
   * @returns a `{ synced, skipped, failed }` summary
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async syncTemplates(
    tenantId: string,
    actorId: string | null,
    dto: SyncRadiologyTestTemplatesDto,
  ): Promise<RadiologyTestSyncResult> {
    await this.masterDataService.findById(dto.masterDataId, tenantId);
    const where: Prisma.RadiologyTestWhereInput = {
      tenantId,
      masterDataId: dto.masterDataId,
      clonedFromId: { not: null },
      deletedAt: null,
    };
    if (dto.radiologyTestIds?.length) {
      where.id = { in: dto.radiologyTestIds };
    }
    const tests = await this.prisma.radiologyTest.findMany({ where });

    const result: RadiologyTestSyncResult = {
      synced: [],
      skipped: [],
      failed: [],
    };
    for (const test of tests) {
      const templateId = test.clonedFromId;
      if (!templateId) {
        continue;
      }
      const template = await this.prisma.radiologyTest.findFirst({
        where: {
          id: templateId,
          source: DataSource.SITE_ADMIN,
          deletedAt: null,
        },
      });
      if (!template) {
        result.skipped.push({
          radiologyTestId: test.id,
          testName: test.testName,
          templateId,
          reason: 'Source template removed',
        });
        continue;
      }
      try {
        await this.prisma.withTenant(tenantId, async (tx) => {
          const history = this.readVersionHistory(test.versionHistory);
          const today = new Date().toISOString().slice(0, 10);
          const open = history.find((e) => e.effectiveTo === null);
          if (open) {
            open.effectiveTo = this.previousDay(today);
          }
          const nextVersion =
            history.reduce((max, e) => Math.max(max, e.version), 0) + 1;
          history.push({
            version: nextVersion,
            effectiveFrom: today,
            effectiveTo: null,
            modifiedBy: actorId,
            approvedBy: null,
          });
          await tx.radiologyTest.update({
            where: { id: test.id },
            data: {
              ...this.stripMeta(template),
              templateSyncedAt: new Date(),
              versionHistory: history as unknown as Prisma.InputJsonValue,
            },
          });
        });
        result.synced.push({
          radiologyTestId: test.id,
          testName: template.testName,
          templateId,
        });
      } catch (e) {
        result.failed.push({
          radiologyTestId: test.id,
          testName: test.testName,
          templateId,
          reason: this.conflictReason(e, template.testName, template.testCode),
        });
      }
    }
    return result;
  }

  /**
   * Clone a SITE_ADMIN template radiology test into a tenant within an EXISTING
   * transaction — used by `RadiologyPanelService` when adopting a template panel,
   * so the panel and its cloned member tests share one all-or-nothing
   * transaction. Returns the new TENANT test row.
   * @param tx the caller's transaction client (already in `withTenant`)
   * @param templateId the SITE_ADMIN template test to clone
   * @param target tenant/branch/master data for the new test
   * @throws RadiologyTestNotFoundException if `templateId` is not a live template
   */
  async cloneTemplateTestWithinTx(
    tx: Prisma.TransactionClient,
    templateId: string,
    target: { tenantId: string; branchId: string | null; masterDataId: string },
  ): Promise<RadiologyTest> {
    const template = await tx.radiologyTest.findFirst({
      where: { id: templateId, source: DataSource.SITE_ADMIN, deletedAt: null },
    });
    if (!template) {
      throw new RadiologyTestNotFoundException(templateId);
    }
    return this.clonePersistTest(tx, template, {
      tenantId: target.tenantId,
      branchId: target.branchId,
      masterDataId: target.masterDataId,
      source: DataSource.TENANT,
      actorId: null,
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Persist a clone of a radiology test onto the target scope with fresh
   * identity/provenance and a seed version. `clonedFromId` is tracked only when
   * adopting a SITE_ADMIN template into a tenant (a tenant→tenant clone keeps it
   * NULL). Runs inside the caller's transaction.
   */
  private async clonePersistTest(
    tx: Prisma.TransactionClient,
    src: RadiologyTest,
    target: {
      tenantId: string | null;
      branchId: string | null;
      masterDataId: string | null;
      source: DataSource;
      actorId: string | null;
    },
  ): Promise<RadiologyTest> {
    const { tenantId, branchId, masterDataId, source, actorId } = target;
    const clonedFromId = src.source === DataSource.SITE_ADMIN ? src.id : null;
    return tx.radiologyTest.create({
      data: {
        ...this.stripMeta(src),
        tenantId,
        branchId,
        masterDataId,
        source,
        clonedFromId,
        versionHistory: [
          this.seedVersion(actorId),
        ] as unknown as Prisma.InputJsonValue,
      } as Prisma.RadiologyTestUncheckedCreateInput,
    });
  }

  /**
   * Fetch one active radiology test scoped to its tenant + master data.
   * @throws RadiologyTestNotFoundException if missing/soft-deleted/other master data
   */
  private async findCoreById(
    radiologyTestId: string,
    masterDataId: string,
    tenantId: string,
  ): Promise<RadiologyTest> {
    const row = await this.prisma.radiologyTest.findFirst({
      where: { id: radiologyTestId, masterDataId, tenantId, deletedAt: null },
    });
    if (!row) {
      throw new RadiologyTestNotFoundException(radiologyTestId);
    }
    return row;
  }

  /**
   * Fetch one active SITE_ADMIN template radiology test (core row only).
   * @throws RadiologyTestNotFoundException if missing/soft-deleted/not a template
   */
  private async findCoreTemplateById(
    radiologyTestId: string,
  ): Promise<RadiologyTest> {
    const row = await this.prisma.radiologyTest.findFirst({
      where: {
        id: radiologyTestId,
        source: DataSource.SITE_ADMIN,
        deletedAt: null,
      },
    });
    if (!row) {
      throw new RadiologyTestNotFoundException(radiologyTestId);
    }
    return row;
  }

  /** Strip re-derived meta keys from a row before copying it. */
  private stripMeta(row: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...row };
    for (const key of META_KEYS) {
      delete copy[key];
    }
    return copy;
  }

  /** Build the seed v1 version entry for a freshly-created test. */
  private seedVersion(actorId: string | null): RadiologyTestVersionEntry {
    return {
      version: 1,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: null,
      modifiedBy: actorId,
      approvedBy: null,
    };
  }

  /** Read a radiology test's `versionHistory` Json into a typed, mutable array. */
  private readVersionHistory(
    value: Prisma.JsonValue,
  ): RadiologyTestVersionEntry[] {
    return Array.isArray(value)
      ? (value as unknown as RadiologyTestVersionEntry[])
      : [];
  }

  /** The day before a `YYYY-MM-DD` date, as `YYYY-MM-DD` (UTC). */
  private previousDay(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /** Enforce price ordering (min ≤ max ≤ msrp) ahead of the DB CHECK constraints. */
  private assertPriceOrdering(prices: {
    priceMsrp: number;
    priceMaximum: number;
    priceMinimum: number;
  }): void {
    if (prices.priceMaximum > prices.priceMsrp) {
      throw new ValidationException('Price Maximum must be ≤ Price MSRP', {
        priceMaximum: String(prices.priceMaximum),
        priceMsrp: String(prices.priceMsrp),
      });
    }
    if (prices.priceMinimum > prices.priceMaximum) {
      throw new ValidationException('Price Minimum must be ≤ Price Maximum', {
        priceMinimum: String(prices.priceMinimum),
        priceMaximum: String(prices.priceMaximum),
      });
    }
  }

  /**
   * Check whether a catalogue row (department / category / sub-category) exists
   * as an active row of the given tenant.
   */
  private async catalogueRowExists(
    tenantId: string,
    model: 'department' | 'category' | 'subCategory',
    id: string,
  ): Promise<boolean> {
    const where = { id, tenantId, deletedAt: null };
    const select = { id: true };
    switch (model) {
      case 'department':
        return (
          (await this.prisma.department.findFirst({ where, select })) !== null
        );
      case 'category':
        return (
          (await this.prisma.category.findFirst({ where, select })) !== null
        );
      case 'subCategory':
        return (
          (await this.prisma.subCategory.findFirst({ where, select })) !== null
        );
    }
  }

  /**
   * Validate that any provided classification catalogue refs point at an active
   * row of the caller's tenant.
   * @throws ValidationException if a provided id is not a live row of this tenant
   */
  private async assertCatalogueRefs(
    tenantId: string,
    refs: {
      departmentId?: string | null;
      categoryId?: string | null;
      subCategoryId?: string | null;
    },
  ): Promise<void> {
    const checks: ReadonlyArray<
      [
        string | null | undefined,
        'department' | 'category' | 'subCategory',
        string,
        string,
      ]
    > = [
      [refs.departmentId, 'department', 'departmentId', 'department'],
      [refs.categoryId, 'category', 'categoryId', 'category'],
      [refs.subCategoryId, 'subCategory', 'subCategoryId', 'sub-category'],
    ];
    for (const [id, model, field, label] of checks) {
      if (id && !(await this.catalogueRowExists(tenantId, model, id))) {
        throw new ValidationException(
          `${field} does not reference an existing ${label}`,
          { [field]: id },
        );
      }
    }
  }

  /**
   * Translate a Prisma unique-constraint (P2002) into a typed name/code conflict.
   */
  private rethrowConflict(
    e: unknown,
    testName: string,
    testCode: string,
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
    if (target.includes('test_code')) {
      throw new RadiologyTestCodeConflictException(testCode);
    }
    throw new RadiologyTestNameConflictException(testName);
  }

  /**
   * Human-readable reason for a per-row import/sync failure. Maps a P2002 to a
   * friendly message; falls back to a generic message for anything else.
   */
  private conflictReason(
    e: unknown,
    testName: string,
    testCode: string,
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
      if (target.includes('test_code')) {
        return `Test code "${testCode}" already exists in this master data`;
      }
      return `Test name "${testName}" already exists in this master data`;
    }
    return 'Unexpected error while importing this test';
  }
}
