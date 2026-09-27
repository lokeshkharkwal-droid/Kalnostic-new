import { Injectable } from '@nestjs/common';
import {
  DataSource,
  ParameterType,
  Prisma,
  OpdTest,
  OpdTestReferenceRange,
  OpdTestReferenceValue,
  OpdTestResultParam,
  OpdTestSample,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import {
  KaltrosException,
  ValidationException,
} from '../../common/exceptions/kaltros.exception';
import { OpdMasterDataService } from '../opd-master-data/opd-master-data.service';
import { CreateOpdTestDto } from './dto/create-opd-test.dto';
import { UpdateOpdTestDto } from './dto/update-opd-test.dto';
import {
  BrowseOpdTestTemplatesDto,
  ListOpdTestsDto,
} from './dto/list-opd-tests.dto';
import { OpdTestResultParamDto } from './dto/opd-test-result-param.dto';
import { OpdTestReferenceRangeDto } from './dto/opd-test-reference-range.dto';
import { AddOpdTestVersionDto } from './dto/add-opd-test-version.dto';
import { BulkEditOpdTestsDto } from './dto/bulk-edit-opd-tests.dto';
import { ImportOpdTestTemplatesDto } from './dto/import-opd-test-templates.dto';
import { SyncOpdTestTemplatesDto } from './dto/sync-opd-test-templates.dto';
import {
  ImportableTemplateRow,
  OpdTestImportResult,
  OpdTestListRow,
  OpdTestListView,
  OpdTestRefRangeRow,
  OpdTestRefValueRow,
  OpdTestResultsParamRow,
  OpdTestSampleRow,
  OpdTestSyncResult,
  OpdTestVersionEntry,
  OpdTestWithChildren,
  ReflexTestRef,
} from './entities/opd-test.entity';
import {
  CircularFormulaDependencyException,
  InvalidFormulaException,
  OpdTestCodeConflictException,
  OpdTestNameConflictException,
  OpdTestNotFoundException,
  OpdTestParamCodeConflictException,
  OpdTestSampleRequiredException,
  UnknownFormulaReferenceException,
} from './exceptions/opd-test.exceptions';
import { FormulaParam, validateFormulaSet } from '../../common/utils/formula';

/** Result of a bulk edit: how many opd tests were updated. */
export interface BulkEditResult {
  updated: number;
}

/** Result of a clone operation: how many tests were copied vs skipped. */
export interface CloneResult {
  copied: number;
  skipped: number;
}

/** Row keys that are re-derived (never copied) when cloning. */
const META_KEYS = [
  'id',
  'tenantId',
  'branchId',
  'masterDataId',
  'labTestId',
  'paramId',
  'source',
  'clonedFromId',
  'templateSyncedAt',
  'sourceMasterLabTestId',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'versionHistory',
];

/**
 * Classification / mandatory-test refs forced NULL (and `isMandatoryTest` false)
 * when creating/updating a SITE_ADMIN template — a global template belongs to no
 * tenant, so it cannot reference tenant-scoped catalogue rows.
 */
const TEMPLATE_NULLED_REFS = {
  departmentId: null,
  categoryId: null,
  subCategoryId: null,
  mandatoryDeptId: null,
  mandatoryCatId: null,
  mandatorySubcatId: null,
  isMandatoryTest: false,
} as const;

/**
 * Opd-test configuration management. Tenant-scoped + branch-level; every
 * test lives inside a master data (`masterDataId`) whose tenant/branch it inherits.
 * Child rows (samples, result params, reference ranges/values) are managed nested
 * in the test payload. Prisma-direct; multi-step writes run in `withTenant`
 * transactions. Classification refs (`departmentId`/`categoryId`/`subCategoryId`/
 * mandatory-*) are logical refs — there is no Prisma relation, so filters/sorts on
 * them use the plain id columns.
 */
@Injectable()
export class OpdTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: OpdMasterDataService,
  ) {}

  /**
   * Create a opd test inside a master data, with its samples and result
   * parameters (each carrying its reference ranges/values). The master data is
   * validated to belong to the caller's tenant (and supplies `branchId`). Seeds
   * `versionHistory` with v1. All inserts run in one transaction.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param actorId person id recorded as `modifiedBy` on the seeded v1
   * @param dto validated payload
   * @returns the created opd test with all children
   * @throws OpdMasterDataNotFoundException if the master data is missing
   * @throws ValidationException on a cross-field invariant violation
   */
  async create(
    masterDataId: string,
    tenantId: string,
    actorId: string,
    dto: CreateOpdTestDto,
  ): Promise<OpdTestWithChildren> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );
    if (!dto.samples?.length) throw new OpdTestSampleRequiredException();
    this.assertCoreInvariants({
      priceMsrp: dto.priceMsrp ?? 0,
      priceMaximum: dto.priceMaximum ?? 0,
      priceMinimum: dto.priceMinimum ?? 0,
      isMandatoryTest: dto.isMandatoryTest ?? false,
      mandatoryDeptId: dto.mandatoryDeptId ?? null,
      isRepeatIntervalRestriction: dto.isRepeatIntervalRestriction ?? false,
      repeatIntervalValue: dto.repeatIntervalValue ?? null,
      repeatIntervalUnit: dto.repeatIntervalUnit ?? null,
    });
    await this.assertCatalogueRefs(tenantId, {
      departmentId: dto.departmentId,
      categoryId: dto.categoryId,
      subCategoryId: dto.subCategoryId,
      mandatoryDeptId: dto.mandatoryDeptId,
      mandatoryCatId: dto.mandatoryCatId,
      mandatorySubcatId: dto.mandatorySubcatId,
    });
    (dto.resultParams ?? []).forEach((p) => this.assertParam(p));
    this.assertFormulaSet(dto.resultParams ?? []);

    const { samples, resultParams, ...scalars } = dto;
    let createdId: string;
    try {
      createdId = await this.prisma.withTenant(tenantId, async (tx) => {
        const test = await tx.opdTest.create({
          data: {
            ...scalars,
            tenantId,
            branchId: masterData.branchId,
            masterDataId,
            versionHistory: [
              this.seedVersion(actorId),
            ] as unknown as Prisma.InputJsonValue,
          },
        });
        await this.createSamples(
          tx,
          tenantId,
          masterData.branchId,
          test.id,
          samples,
        );
        await this.createParams(
          tx,
          tenantId,
          masterData.branchId,
          test.id,
          resultParams,
        );
        return test.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.testName, dto.testCode);
      throw e;
    }
    return this.findById(masterDataId, createdId, tenantId);
  }

  /**
   * Fetch one opd test composed with its samples and result parameters.
   * @param masterDataId parent master data id
   * @param labTestId opd test id
   * @param tenantId tenant scope
   * @throws OpdTestNotFoundException if missing/soft-deleted/other master data
   */
  async findById(
    masterDataId: string,
    labTestId: string,
    tenantId: string,
  ): Promise<OpdTestWithChildren> {
    const test = await this.findCoreById(labTestId, masterDataId, tenantId);
    return this.composeWithChildren(test);
  }

  /**
   * Compose a (already-fetched) opd test with its samples and result
   * parameters (each with its reference ranges/values). Serves both the tenant and
   * template read paths (children scoped to the test's own tenantId, NULL for
   * templates).
   * @param test the core opd-test row
   */
  private async composeWithChildren(
    test: OpdTest,
  ): Promise<OpdTestWithChildren> {
    const { id: labTestId, tenantId } = test;
    const [samples, params] = await Promise.all([
      this.prisma.opdTestSample.findMany({
        where: { labTestId, tenantId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.opdTestResultParam.findMany({
        where: { labTestId, tenantId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const [ranges, values] = await Promise.all([
      this.prisma.opdTestReferenceRange.findMany({
        where: { labTestId, tenantId, deletedAt: null },
      }),
      this.prisma.opdTestReferenceValue.findMany({
        where: { labTestId, tenantId, deletedAt: null },
      }),
    ]);
    return {
      ...test,
      samples,
      resultParams: params.map((p) => ({
        ...p,
        referenceRanges: ranges.filter((r) => r.paramId === p.id),
        referenceValues: values.filter((v) => v.paramId === p.id),
        reflexTests: (p.reflexTests ?? []) as unknown as ReflexTestRef[],
      })),
    };
  }

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /opd-tests/options`). Tenant-scoped to active tests; optionally
   * filtered by `branchId` and a case-insensitive `testName` search. Full array
   * when `page` omitted, else a paginated envelope.
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
    const where: Prisma.OpdTestWhereInput = {
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
      const rows = await this.prisma.opdTest.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.testName }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.opdTest.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.opdTest.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.testName })),
      total,
      page,
      limit,
    };
  }

  /**
   * Lightweight `{ id, name }` options for **SITE_ADMIN template** opd tests
   * (`GET /siteadmin/opd-tests/options`). Full array when `page` omitted,
   * else a paginated envelope.
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
    const where: Prisma.OpdTestWhereInput = {
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
      const rows = await this.prisma.opdTest.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.testName }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.opdTest.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.opdTest.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.testName })),
      total,
      page,
      limit,
    };
  }

  /**
   * List active opd tests in a master data (offset pagination; core rows).
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param query pagination + filters
   * @throws OpdMasterDataNotFoundException if the master data is missing
   */
  async findAll(
    masterDataId: string,
    tenantId: string,
    query: ListOpdTestsDto = {},
  ): Promise<PaginatedResult<OpdTest>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = await this.buildListWhere(masterDataId, tenantId, query);
    const [data, total] = await Promise.all([
      this.prisma.opdTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.opdTest.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Build the shared `where` clause for the opd-test list/listing endpoints.
   * Classification filters use plain id columns (logical refs); `sampleType` uses a
   * child-sample subquery; `status` → `isActive`.
   */
  private async buildListWhere(
    masterDataId: string,
    tenantId: string,
    query: ListOpdTestsDto,
  ): Promise<Prisma.OpdTestWhereInput> {
    const where: Prisma.OpdTestWhereInput = {
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
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.subCategoryId) where.subCategoryId = query.subCategoryId;
    const sampleType = query.sampleType?.trim();
    if (sampleType) {
      const sampleRows = await this.prisma.opdTestSample.findMany({
        where: { tenantId, sampleType, deletedAt: null },
        select: { labTestId: true },
      });
      where.id = { in: sampleRows.map((s) => s.labTestId) };
    }
    if (query.status) where.isActive = query.status === 'ACTIVE';
    return where;
  }

  /**
   * List opd tests in a master data for the configurable listing screen.
   * Supports search, classification + status filters, and a `view` projecting a
   * different column subset (and nested arrays for child-centric views).
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param query view + filters + pagination
   * @returns a paginated list of view-specific projection rows
   * @throws OpdMasterDataNotFoundException if the master data is missing
   */
  async listForView(
    masterDataId: string,
    tenantId: string,
    query: ListOpdTestsDto,
  ): Promise<PaginatedResult<OpdTestListRow>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const view = query.view ?? OpdTestListView.DEFAULT;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = await this.buildListWhere(masterDataId, tenantId, query);
    const sort = this.buildListOrderBy(query.sortBy, query.sortOrder);

    if (sort.kind === 'derived') {
      const tests = await this.sortByChildCount(
        where,
        tenantId,
        sort.field,
        sort.dir,
        page,
        limit,
      );
      const total = await this.prisma.opdTest.count({ where });
      const data = await this.projectListRows(view, tenantId, tests);
      return { data, total, page, limit };
    }

    const [tests, total] = await Promise.all([
      this.prisma.opdTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: sort.orderBy,
      }),
      this.prisma.opdTest.count({ where }),
    ]);

    const data = await this.projectListRows(view, tenantId, tests);
    return { data, total, page, limit };
  }

  /**
   * Resolve a listing `sortBy`/`sortOrder` (`1` asc / `-1` desc) into a Prisma
   * `orderBy` (scalar column) or a `derived` marker for child-count sorts. Since
   * classification is a logical ref (no relation), `departmentName` cannot be
   * sorted at the DB layer and falls back to `createdAt desc`.
   */
  private buildListOrderBy(
    sortBy: ListOpdTestsDto['sortBy'],
    sortOrder: ListOpdTestsDto['sortOrder'],
  ):
    | { kind: 'prisma'; orderBy: Prisma.OpdTestOrderByWithRelationInput }
    | {
        kind: 'derived';
        field: 'parametersCount' | 'samplesCount';
        dir: 'asc' | 'desc';
      } {
    const dir: 'asc' | 'desc' = sortOrder === -1 ? 'desc' : 'asc';
    if (!sortBy) {
      return { kind: 'prisma', orderBy: { createdAt: 'desc' } };
    }
    // No `department` relation on OpdTest — fall back to createdAt.
    if (sortBy === 'departmentName') {
      return { kind: 'prisma', orderBy: { createdAt: 'desc' } };
    }
    if (sortBy === 'parametersCount' || sortBy === 'samplesCount') {
      return { kind: 'derived', field: sortBy, dir };
    }
    return { kind: 'prisma', orderBy: { [sortBy]: dir } };
  }

  /**
   * Sort the whole filtered set by an active child-row count, then return the
   * requested page's rows in sorted order (ties break newest-first).
   */
  private async sortByChildCount(
    where: Prisma.OpdTestWhereInput,
    tenantId: string | null,
    field: 'parametersCount' | 'samplesCount',
    dir: 'asc' | 'desc',
    page: number,
    limit: number,
  ): Promise<OpdTest[]> {
    const all = await this.prisma.opdTest.findMany({
      where,
      select: { id: true, createdAt: true },
    });
    if (all.length === 0) {
      return [];
    }
    const counts = await this.countByTest(
      field === 'samplesCount' ? 'opdTestSample' : 'opdTestResultParam',
      tenantId,
      all.map((t) => t.id),
    );
    const factor = dir === 'asc' ? 1 : -1;
    const pageIds = all
      .map((t) => ({
        id: t.id,
        createdAt: t.createdAt,
        value: counts.get(t.id) ?? 0,
      }))
      .sort((a, b) =>
        a.value !== b.value
          ? (a.value - b.value) * factor
          : b.createdAt.getTime() - a.createdAt.getTime(),
      )
      .slice((page - 1) * limit, page * limit)
      .map((x) => x.id);

    const rows = await this.prisma.opdTest.findMany({
      where: { id: { in: pageIds } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return pageIds
      .map((id) => byId.get(id))
      .filter((r): r is OpdTest => r !== undefined);
  }

  // ── Listing projection ────────────────────────────────────────────────────────

  /**
   * Project a page of opd tests into the requested view's row shape. Fetches
   * only the children/counts/names the view needs, batched over the page's ids.
   */
  private async projectListRows(
    view: OpdTestListView,
    tenantId: string | null,
    tests: OpdTest[],
  ): Promise<OpdTestListRow[]> {
    if (tests.length === 0) {
      return [];
    }
    const ids = tests.map((t) => t.id);

    switch (view) {
      case OpdTestListView.DEFAULT: {
        const [deptNames, defaultSamples, paramCounts] = await Promise.all([
          this.resolveNames(
            'department',
            tenantId,
            tests.map((t) => t.departmentId),
          ),
          this.fetchDefaultSamples(tenantId, ids),
          this.countByTest('opdTestResultParam', tenantId, ids),
        ]);
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          testCode: t.testCode,
          departmentName: this.nameOf(deptNames, t.departmentId),
          priceMsrp: t.priceMsrp,
          tatMaxValue: t.tatMaxValue,
          tatMaxUnit: t.tatMaxUnit,
          defaultSample: defaultSamples.get(t.id) ?? null,
          parametersCount: paramCounts.get(t.id) ?? 0,
          isActive: t.isActive,
        }));
      }

      case OpdTestListView.BASIC_DETAILS: {
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
          departmentName: this.nameOf(deptNames, t.departmentId),
          categoryName: this.nameOf(catNames, t.categoryId),
          subCategoryName: this.nameOf(subCatNames, t.subCategoryId),
          processMethod: t.processMethod,
          approvalWorkflow: t.approvalWorkflow,
          isMandatoryTest: t.isMandatoryTest,
          samplePriorityType: t.samplePriorityType,
          icdCode: t.icdCode,
          loincCode: t.loincCode,
        }));
      }

      case OpdTestListView.PRICING:
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

      case OpdTestListView.TAT:
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          tatMinValue: t.tatMinValue,
          tatMinUnit: t.tatMinUnit,
          tatMaxValue: t.tatMaxValue,
          tatMaxUnit: t.tatMaxUnit,
          scheduleFrom: t.scheduleFrom,
          scheduleTo: t.scheduleTo,
          processingTimeFrom: t.processingTimeFrom,
          processingTimeTo: t.processingTimeTo,
          procTimeMinValue: t.procTimeMinValue,
          procTimeMinUnit: t.procTimeMinUnit,
          procTimeMaxValue: t.procTimeMaxValue,
          procTimeMaxUnit: t.procTimeMaxUnit,
          approvalTimeFrom: t.approvalTimeFrom,
          approvalTimeTo: t.approvalTimeTo,
          reportingTimeFrom: t.reportingTimeFrom,
          reportingTimeTo: t.reportingTimeTo,
          approvalDurationMinValue: t.approvalDurationMinValue,
          approvalDurationMinUnit: t.approvalDurationMinUnit,
          approvalDurationMaxValue: t.approvalDurationMaxValue,
          approvalDurationMaxUnit: t.approvalDurationMaxUnit,
        }));

      case OpdTestListView.FLAGS:
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          isHideInOrderScreen: t.isHideInOrderScreen,
          isEnableCms: t.isEnableCms,
          isPreferenceTest: t.isPreferenceTest,
          isOutsource: t.isOutsource,
          isBillOnlyTest: t.isBillOnlyTest,
          isSampleFlow: t.isSampleFlow,
          isActive: t.isActive,
        }));

      case OpdTestListView.SAMPLE: {
        const [deptNames, samplesByTest] = await Promise.all([
          this.resolveNames(
            'department',
            tenantId,
            tests.map((t) => t.departmentId),
          ),
          this.fetchSamples(tenantId, ids),
        ]);
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          testCode: t.testCode,
          departmentName: this.nameOf(deptNames, t.departmentId),
          isActive: t.isActive,
          samples: (samplesByTest.get(t.id) ?? []).map(
            (s): OpdTestSampleRow => ({
              id: s.id,
              sampleNameId: s.sampleNameId,
              sampleType: s.sampleType,
              containerType: s.containerType,
              sampleSize: s.sampleSize,
              isFastingRequired: s.isFastingRequired,
              transportTemperature: s.transportTemperature,
            }),
          ),
        }));
      }

      case OpdTestListView.RESULTS: {
        const [deptNames, paramsByTest] = await Promise.all([
          this.resolveNames(
            'department',
            tenantId,
            tests.map((t) => t.departmentId),
          ),
          this.fetchParams(tenantId, ids),
        ]);
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          testCode: t.testCode,
          departmentName: this.nameOf(deptNames, t.departmentId),
          isActive: t.isActive,
          resultParams: (paramsByTest.get(t.id) ?? []).map(
            (p): OpdTestResultsParamRow => ({
              id: p.id,
              parameterName: p.parameterName,
              method: p.method,
              resultType: p.resultType,
              units: p.reportingUnit,
              isNabl: p.isNabl,
              isCap: p.isCap,
            }),
          ),
        }));
      }

      case OpdTestListView.REFERENCE_RANGE: {
        const [paramsByTest, rangesByTest] = await Promise.all([
          this.fetchParams(tenantId, ids),
          this.fetchRanges(tenantId, ids),
        ]);
        return tests.map((t) => {
          const paramMap = this.indexById(paramsByTest.get(t.id) ?? []);
          return {
            id: t.id,
            testName: t.testName,
            testCode: t.testCode,
            referenceRanges: (rangesByTest.get(t.id) ?? []).map(
              (r): OpdTestRefRangeRow => {
                const param = paramMap.get(r.paramId);
                return {
                  id: r.id,
                  paramId: r.paramId,
                  parameterName: param?.parameterName ?? '',
                  method: r.method ?? param?.method ?? null,
                  gender: r.gender,
                  ageFrom: r.ageFrom,
                  ageTo: r.ageTo,
                  lowerLimit: r.lowerLimit,
                  upperLimit: r.upperLimit,
                  displayOfReferenceRange: r.displayOfReferenceRange,
                  flag: r.abnormalFlagLogic,
                };
              },
            ),
          };
        });
      }

      case OpdTestListView.REFERENCE_VALUE: {
        const [paramsByTest, valuesByTest] = await Promise.all([
          this.fetchParams(tenantId, ids),
          this.fetchValues(tenantId, ids),
        ]);
        return tests.map((t) => {
          const paramMap = this.indexById(paramsByTest.get(t.id) ?? []);
          return {
            id: t.id,
            testName: t.testName,
            testCode: t.testCode,
            referenceValues: (valuesByTest.get(t.id) ?? []).map(
              (v): OpdTestRefValueRow => {
                const param = paramMap.get(v.paramId);
                return {
                  id: v.id,
                  paramId: v.paramId,
                  parameterName: param?.parameterName ?? '',
                  method: v.method ?? param?.method ?? null,
                  gender: v.gender,
                  ageFrom: v.ageFrom,
                  ageTo: v.ageTo,
                  displayValue: v.normalValueText,
                  flag: v.abnormalFlagLogic,
                };
              },
            ),
          };
        });
      }

      case OpdTestListView.NOTES:
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          usefulFor: t.usefulFor,
          interpretationOfResults: t.interpretationOfResults,
          limitations: t.limitations,
          remarks: t.remarks,
          references: t.references,
        }));

      case OpdTestListView.VERSION_CONTROL:
        return tests.map((t) => {
          const history = this.readVersionHistory(t.versionHistory);
          const current = this.currentVersion(history);
          return {
            id: t.id,
            testName: t.testName,
            currentVersion: current?.version ?? null,
            effectiveFrom: current?.effectiveFrom ?? null,
            modifiedBy: current?.modifiedBy ?? null,
            versionHistory: history,
          };
        });

      case OpdTestListView.OVERVIEW: {
        const [deptNames, sampleCounts, paramCounts] = await Promise.all([
          this.resolveNames(
            'department',
            tenantId,
            tests.map((t) => t.departmentId),
          ),
          this.countByTest('opdTestSample', tenantId, ids),
          this.countByTest('opdTestResultParam', tenantId, ids),
        ]);
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          testCode: t.testCode,
          departmentName: this.nameOf(deptNames, t.departmentId),
          maxValue: t.priceMaximum,
          tatMaxValue: t.tatMaxValue,
          tatMaxUnit: t.tatMaxUnit,
          samplesCount: sampleCounts.get(t.id) ?? 0,
          parametersCount: paramCounts.get(t.id) ?? 0,
          isActive: t.isActive,
        }));
      }
    }
  }

  /**
   * Resolve a set of classification ids to an `id → name` map (tenant-scoped).
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

  /** The default sample per test (`isDefault`), keyed by `labTestId`. */
  private async fetchDefaultSamples(
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, OpdTestSample>> {
    const rows = await this.prisma.opdTestSample.findMany({
      where: {
        labTestId: { in: ids },
        tenantId,
        deletedAt: null,
        isDefault: true,
      },
    });
    const map = new Map<string, OpdTestSample>();
    for (const r of rows) {
      if (!map.has(r.labTestId)) {
        map.set(r.labTestId, r);
      }
    }
    return map;
  }

  /** All active samples grouped by `labTestId`. */
  private async fetchSamples(
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, OpdTestSample[]>> {
    const rows = await this.prisma.opdTestSample.findMany({
      where: { labTestId: { in: ids }, tenantId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return this.groupByKey(rows, (r) => r.labTestId);
  }

  /** All active result parameters grouped by `labTestId`. */
  private async fetchParams(
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, OpdTestResultParam[]>> {
    const rows = await this.prisma.opdTestResultParam.findMany({
      where: { labTestId: { in: ids }, tenantId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return this.groupByKey(rows, (r) => r.labTestId);
  }

  /** All active reference ranges grouped by `labTestId`. */
  private async fetchRanges(
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, OpdTestReferenceRange[]>> {
    const rows = await this.prisma.opdTestReferenceRange.findMany({
      where: { labTestId: { in: ids }, tenantId, deletedAt: null },
    });
    return this.groupByKey(rows, (r) => r.labTestId);
  }

  /** All active reference values grouped by `labTestId`. */
  private async fetchValues(
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, OpdTestReferenceValue[]>> {
    const rows = await this.prisma.opdTestReferenceValue.findMany({
      where: { labTestId: { in: ids }, tenantId, deletedAt: null },
    });
    return this.groupByKey(rows, (r) => r.labTestId);
  }

  /** Count active child rows of one model per test, keyed by `labTestId`. */
  private async countByTest(
    model: 'opdTestSample' | 'opdTestResultParam',
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, number>> {
    const where = { labTestId: { in: ids }, tenantId, deletedAt: null };
    const grouped =
      model === 'opdTestSample'
        ? await this.prisma.opdTestSample.groupBy({
            by: ['labTestId'],
            where,
            _count: { _all: true },
          })
        : await this.prisma.opdTestResultParam.groupBy({
            by: ['labTestId'],
            where,
            _count: { _all: true },
          });
    const map = new Map<string, number>();
    for (const g of grouped) {
      map.set(g.labTestId, g._count._all);
    }
    return map;
  }

  /** Group an array of rows into a `key → rows[]` map. */
  private groupByKey<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      const arr = map.get(k);
      if (arr) {
        arr.push(r);
      } else {
        map.set(k, [r]);
      }
    }
    return map;
  }

  /** Index a list of result parameters by their id. */
  private indexById(
    params: OpdTestResultParam[],
  ): Map<string, OpdTestResultParam> {
    const map = new Map<string, OpdTestResultParam>();
    for (const p of params) {
      map.set(p.id, p);
    }
    return map;
  }

  /** The "current" version entry: the open one (`effectiveTo === null`) else the highest. */
  private currentVersion(
    history: OpdTestVersionEntry[],
  ): OpdTestVersionEntry | null {
    const open = history.find((e) => e.effectiveTo === null);
    if (open) {
      return open;
    }
    return history.reduce<OpdTestVersionEntry | null>(
      (acc, e) => (!acc || e.version > acc.version ? e : acc),
      null,
    );
  }

  /**
   * Update a opd test. Core fields are patched; when `samples` or
   * `resultParams` is provided, that child set is replaced (samples full-replace;
   * params matched-and-patched by `parameterCode`) in one transaction.
   * @param masterDataId parent master data id
   * @param labTestId opd test id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws OpdTestNotFoundException / ValidationException / conflict exceptions
   */
  async update(
    masterDataId: string,
    labTestId: string,
    tenantId: string,
    dto: UpdateOpdTestDto,
  ): Promise<OpdTestWithChildren> {
    const existing = await this.findCoreById(labTestId, masterDataId, tenantId);
    if (dto.samples !== undefined && dto.samples.length < 1) {
      throw new OpdTestSampleRequiredException();
    }
    this.assertCoreInvariants({
      priceMsrp: dto.priceMsrp ?? existing.priceMsrp,
      priceMaximum: dto.priceMaximum ?? existing.priceMaximum,
      priceMinimum: dto.priceMinimum ?? existing.priceMinimum,
      isMandatoryTest: dto.isMandatoryTest ?? existing.isMandatoryTest,
      mandatoryDeptId: dto.mandatoryDeptId ?? existing.mandatoryDeptId ?? null,
      isRepeatIntervalRestriction:
        dto.isRepeatIntervalRestriction ?? existing.isRepeatIntervalRestriction,
      repeatIntervalValue:
        dto.repeatIntervalValue ?? existing.repeatIntervalValue ?? null,
      repeatIntervalUnit:
        dto.repeatIntervalUnit ?? existing.repeatIntervalUnit ?? null,
    });
    await this.assertCatalogueRefs(tenantId, {
      departmentId: dto.departmentId,
      categoryId: dto.categoryId,
      subCategoryId: dto.subCategoryId,
      mandatoryDeptId: dto.mandatoryDeptId,
      mandatoryCatId: dto.mandatoryCatId,
      mandatorySubcatId: dto.mandatorySubcatId,
    });
    (dto.resultParams ?? []).forEach((p) => this.assertParam(p));
    this.assertFormulaSet(dto.resultParams ?? []);

    const { samples, resultParams, ...scalars } = dto;
    const now = new Date();
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.opdTest.update({
          where: { id: labTestId },
          data: scalars,
        });
        if (samples !== undefined) {
          await tx.opdTestSample.updateMany({
            where: { labTestId, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createSamples(
            tx,
            tenantId,
            existing.branchId,
            labTestId,
            samples,
          );
        }
        if (resultParams !== undefined) {
          await this.upsertParamsByCode(
            tx,
            tenantId,
            existing.branchId,
            labTestId,
            resultParams,
            now,
          );
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.testName ?? '', dto.testCode ?? '');
      throw e;
    }
    return this.findById(masterDataId, labTestId, tenantId);
  }

  /**
   * Soft-delete a opd test and cascade soft-delete all children in one
   * transaction.
   * @param masterDataId parent master data id
   * @param labTestId opd test id
   * @param tenantId tenant scope
   * @throws OpdTestNotFoundException if missing/soft-deleted/other master data
   */
  async remove(
    masterDataId: string,
    labTestId: string,
    tenantId: string,
  ): Promise<OpdTest> {
    await this.findCoreById(labTestId, masterDataId, tenantId);
    return this.prisma.withTenant(tenantId, (tx) =>
      this.cascadeDeleteTest(tx, labTestId, tenantId, new Date()),
    );
  }

  /**
   * Soft-delete cascade body shared by `remove()` and `syncTestsIntoBranch`.
   * Assumes the caller has validated the test and owns the tx.
   */
  private async cascadeDeleteTest(
    tx: Prisma.TransactionClient,
    labTestId: string,
    tenantId: string,
    now: Date,
  ): Promise<OpdTest> {
    const where = { labTestId, tenantId, deletedAt: null };
    await tx.opdTestReferenceRange.updateMany({
      where,
      data: { deletedAt: now },
    });
    await tx.opdTestReferenceValue.updateMany({
      where,
      data: { deletedAt: now },
    });
    await tx.opdTestResultParam.updateMany({
      where,
      data: { deletedAt: now },
    });
    await tx.opdTestSample.updateMany({ where, data: { deletedAt: now } });
    return tx.opdTest.update({
      where: { id: labTestId },
      data: { deletedAt: now },
    });
  }

  /**
   * Append a version entry to a opd test's `versionHistory`.
   * @param masterDataId parent master data id
   * @param labTestId opd test id
   * @param tenantId tenant scope
   * @param actorId person id recorded as `modifiedBy`
   * @param dto effective-from (+ optional approver)
   * @throws OpdTestNotFoundException if missing/soft-deleted/other master data
   */
  async addVersion(
    masterDataId: string,
    labTestId: string,
    tenantId: string,
    actorId: string,
    dto: AddOpdTestVersionDto,
  ): Promise<OpdTest> {
    const test = await this.findCoreById(labTestId, masterDataId, tenantId);
    const history = this.readVersionHistory(test.versionHistory);
    const effectiveFrom = dto.effectiveFrom.slice(0, 10);
    const open = history.find((e) => e.effectiveTo === null);
    if (open) {
      open.effectiveTo = this.previousDay(effectiveFrom);
    }
    const nextVersion =
      history.reduce((max, e) => Math.max(max, e.version), 0) + 1;
    history.push({
      version: nextVersion,
      effectiveFrom,
      effectiveTo: null,
      modifiedBy: actorId,
      approvedBy: dto.approvedBy ?? null,
    });
    return this.prisma.opdTest.update({
      where: { id: labTestId },
      data: { versionHistory: history as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Deep-clone all active opd tests from a source master data into a target
   * (both in the caller's tenant). Duplicate `testName`/`testCode` in the target
   * are skipped.
   * @param sourceMasterDataId master data to copy from
   * @param targetMasterDataId master data to copy into
   * @param tenantId tenant scope
   * @returns counts of copied vs skipped tests
   */
  async cloneAll(
    sourceMasterDataId: string,
    targetMasterDataId: string,
    tenantId: string,
  ): Promise<CloneResult> {
    await this.masterDataService.findById(sourceMasterDataId, tenantId);
    const target = await this.masterDataService.findById(
      targetMasterDataId,
      tenantId,
    );
    return this.prisma.withTenant(tenantId, async (tx) => {
      const sourceTests = await tx.opdTest.findMany({
        where: { masterDataId: sourceMasterDataId, tenantId, deletedAt: null },
      });
      const existing = await tx.opdTest.findMany({
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

  /**
   * Sync (update-or-create-or-delete) all active opd tests from a Tenant
   * Master Data into a Branch Master Data, keyed on `sourceMasterLabTestId` (falling
   * back to `testCode`). Matched branch tests are fully overwritten (version bumped,
   * samples rebuilt, params matched-and-patched); unmatched tenant tests are cloned;
   * a branch test whose tenant source is gone (and which was synced, not
   * hand-created) is soft-deleted. Runs inside the caller's transaction. Returns a
   * `tenantTestId → branchLabTestId` map plus counts.
   * @param tx caller's transaction client (already in `withTenant`)
   * @param params tenant + branch scope and both master-data ids
   */
  async syncTestsIntoBranch(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      branchId: string;
      tenantMasterDataId: string;
      branchMasterDataId: string;
      actorId: string | null;
    },
  ): Promise<{
    testIdMap: Map<string, string>;
    created: number;
    updated: number;
    deleted: number;
  }> {
    const {
      tenantId,
      branchId,
      tenantMasterDataId,
      branchMasterDataId,
      actorId,
    } = params;
    const sourceTests = await tx.opdTest.findMany({
      where: { masterDataId: tenantMasterDataId, tenantId, deletedAt: null },
    });
    const branchTests = await tx.opdTest.findMany({
      where: { masterDataId: branchMasterDataId, tenantId, deletedAt: null },
    });
    const bySource = new Map<string, OpdTest>();
    const byCode = new Map<string, OpdTest>();
    for (const t of branchTests) {
      if (t.sourceMasterLabTestId) bySource.set(t.sourceMasterLabTestId, t);
      byCode.set(t.testCode, t);
    }
    const sourceIds = new Set(sourceTests.map((t) => t.id));

    const testIdMap = new Map<string, string>();
    let created = 0;
    let updated = 0;
    for (const src of sourceTests) {
      const target = bySource.get(src.id) ?? byCode.get(src.testCode);
      if (target) {
        const history = this.readVersionHistory(target.versionHistory);
        const today = new Date().toISOString().slice(0, 10);
        const open = history.find((e) => e.effectiveTo === null);
        if (open) open.effectiveTo = this.previousDay(today);
        const nextVersion =
          history.reduce((max, e) => Math.max(max, e.version), 0) + 1;
        history.push({
          version: nextVersion,
          effectiveFrom: today,
          effectiveTo: null,
          modifiedBy: actorId,
          approvedBy: null,
        });
        await tx.opdTest.update({
          where: { id: target.id },
          data: {
            ...this.stripMeta(src),
            sourceMasterLabTestId: src.id,
            versionHistory: history as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.opdTestSample.deleteMany({
          where: { labTestId: target.id, tenantId },
        });
        await this.upsertTestChildren(tx, src.id, src.tenantId, {
          tenantId,
          branchId,
          labTestId: target.id,
        });
        testIdMap.set(src.id, target.id);
        updated += 1;
      } else {
        const cloned = await this.clonePersistTest(tx, src, {
          tenantId,
          branchId,
          masterDataId: branchMasterDataId,
          source: DataSource.TENANT,
          actorId,
          sourceMasterLabTestId: src.id,
        });
        testIdMap.set(src.id, cloned.id);
        created += 1;
      }
    }

    const orphans = branchTests.filter(
      (t) =>
        t.sourceMasterLabTestId !== null && !sourceIds.has(t.sourceMasterLabTestId),
    );
    const now = new Date();
    let deleted = 0;
    for (const orphan of orphans) {
      await this.cascadeDeleteTest(tx, orphan.id, tenantId, now);
      deleted += 1;
    }
    if (orphans.length) {
      await this.cascadeDeleteBranchOpdTestCopies(
        tx,
        tenantId,
        branchId,
        orphans.map((o) => o.id),
        now,
      );
    }

    return { testIdMap, created, updated, deleted };
  }

  /**
   * Soft-delete the branch's operational `BranchOpdTest` copies whose
   * `sourceLabTestId` points at a Branch Master Data test just soft-deleted as an
   * orphan. Scoped to the branch's default (Walk-in) list only; excludes user
   * duplicates. Promotes a remaining sibling to default when needed. Runs inside
   * the caller's tx.
   */
  private async cascadeDeleteBranchOpdTestCopies(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    orphanSourceIds: string[],
    now: Date,
  ): Promise<void> {
    const walkIn = await tx.branchOpdTestList.findFirst({
      where: { tenantId, branchId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    if (!walkIn) {
      return;
    }
    const copies = await tx.branchOpdTest.findMany({
      where: {
        tenantId,
        branchId,
        listId: walkIn.id,
        deletedAt: null,
        isDuplicate: false,
        sourceLabTestId: { in: orphanSourceIds },
      },
      select: { id: true, isDefault: true, sourceLabTestId: true },
    });
    for (const copy of copies) {
      await tx.branchOpdTest.update({
        where: { id: copy.id },
        data: { deletedAt: now },
      });
      if (copy.isDefault && copy.sourceLabTestId) {
        const sibling = await tx.branchOpdTest.findFirst({
          where: {
            tenantId,
            branchId,
            sourceLabTestId: copy.sourceLabTestId,
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (sibling) {
          await tx.branchOpdTest.update({
            where: { id: sibling.id },
            data: { isDefault: true },
          });
        }
      }
    }
  }

  /**
   * Deep-copy one (already-loaded) opd test plus its children into a NEW test
   * with fresh ids, the given scope, and a fresh `versionHistory` v1. Child rows are
   * read from the SOURCE's own scope (NULL for a SITE_ADMIN template). Runs inside
   * the caller's transaction.
   * @returns the newly-created opd test core row
   */
  private async clonePersistTest(
    tx: Prisma.TransactionClient,
    src: OpdTest,
    target: {
      tenantId: string | null;
      branchId: string | null;
      masterDataId: string | null;
      source: DataSource;
      actorId: string | null;
      sourceMasterLabTestId?: string | null;
    },
  ): Promise<OpdTest> {
    const { tenantId, branchId, masterDataId, source, actorId } = target;
    const srcTenantId = src.tenantId;
    const clonedFromId = src.source === DataSource.SITE_ADMIN ? src.id : null;
    const newTest = await tx.opdTest.create({
      data: {
        ...this.stripMeta(src),
        tenantId,
        branchId,
        masterDataId,
        source,
        clonedFromId,
        sourceMasterLabTestId: target.sourceMasterLabTestId ?? null,
        versionHistory: [
          this.seedVersion(actorId),
        ] as unknown as Prisma.InputJsonValue,
      } as Prisma.OpdTestUncheckedCreateInput,
    });

    await this.copyTestChildren(tx, src.id, srcTenantId, {
      tenantId,
      branchId,
      labTestId: newTest.id,
    });
    return newTest;
  }

  /**
   * Copy a opd test's children from `srcTestId` onto `target.labTestId`,
   * re-scoping them and stripping meta keys. Shared by the clone engine and the
   * sync path (which first hard-deletes the existing children). Assumes the correct
   * tenant transaction.
   */
  private async copyTestChildren(
    tx: Prisma.TransactionClient,
    srcTestId: string,
    srcTenantId: string | null,
    target: {
      tenantId: string | null;
      branchId: string | null;
      labTestId: string;
    },
  ): Promise<void> {
    const { tenantId, branchId, labTestId } = target;
    const samples = await tx.opdTestSample.findMany({
      where: { labTestId: srcTestId, tenantId: srcTenantId, deletedAt: null },
    });
    if (samples.length) {
      await tx.opdTestSample.createMany({
        data: samples.map((s) => ({
          ...this.stripMeta(s),
          tenantId,
          branchId,
          labTestId,
        })),
      });
    }

    const params = await tx.opdTestResultParam.findMany({
      where: { labTestId: srcTestId, tenantId: srcTenantId, deletedAt: null },
    });
    for (const param of params) {
      const newParam = await tx.opdTestResultParam.create({
        data: {
          ...this.stripMeta(param),
          tenantId,
          branchId,
          labTestId,
        } as Prisma.OpdTestResultParamUncheckedCreateInput,
      });
      const ranges = await tx.opdTestReferenceRange.findMany({
        where: { paramId: param.id, tenantId: srcTenantId, deletedAt: null },
      });
      if (ranges.length) {
        await tx.opdTestReferenceRange.createMany({
          data: ranges.map((r) => ({
            ...this.stripMeta(r),
            tenantId,
            branchId,
            labTestId,
            paramId: newParam.id,
          })),
        });
      }
      const values = await tx.opdTestReferenceValue.findMany({
        where: { paramId: param.id, tenantId: srcTenantId, deletedAt: null },
      });
      if (values.length) {
        await tx.opdTestReferenceValue.createMany({
          data: values.map((v) => ({
            ...this.stripMeta(v),
            tenantId,
            branchId,
            labTestId,
            paramId: newParam.id,
          })) as Prisma.OpdTestReferenceValueCreateManyInput[],
        });
      }
    }
  }

  /**
   * Refresh an EXISTING test's children from `srcTestId`, matching params by
   * `parameterCode` (case-insensitive) and patching in place to preserve each
   * matched param's id (other modules hold logical references to it). Samples and
   * ranges/values keep the full-replace contract. Assumes the caller has already
   * deleted the target's samples and NOT its params/ranges/values.
   */
  private async upsertTestChildren(
    tx: Prisma.TransactionClient,
    srcTestId: string,
    srcTenantId: string | null,
    target: {
      tenantId: string | null;
      branchId: string | null;
      labTestId: string;
    },
  ): Promise<void> {
    const { tenantId, branchId, labTestId } = target;
    const samples = await tx.opdTestSample.findMany({
      where: { labTestId: srcTestId, tenantId: srcTenantId, deletedAt: null },
    });
    if (samples.length) {
      await tx.opdTestSample.createMany({
        data: samples.map((s) => ({
          ...this.stripMeta(s),
          tenantId,
          branchId,
          labTestId,
        })),
      });
    }

    const existingParams = await tx.opdTestResultParam.findMany({
      where: { labTestId, tenantId, deletedAt: null },
      select: { id: true, parameterCode: true },
    });
    const existingByCode = new Map(
      existingParams.map((p) => [p.parameterCode.toLowerCase(), p.id]),
    );
    const matchedIds = new Set<string>();

    const srcParams = await tx.opdTestResultParam.findMany({
      where: { labTestId: srcTestId, tenantId: srcTenantId, deletedAt: null },
    });
    for (const param of srcParams) {
      const scalars = this.stripMeta(param);
      const existingId = existingByCode.get(param.parameterCode.toLowerCase());

      let paramId: string;
      if (existingId) {
        matchedIds.add(existingId);
        await tx.opdTestResultParam.update({
          where: { id: existingId },
          data: scalars,
        });
        paramId = existingId;
        await tx.opdTestReferenceRange.updateMany({
          where: { paramId, tenantId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        await tx.opdTestReferenceValue.updateMany({
          where: { paramId, tenantId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      } else {
        const createdParam = await tx.opdTestResultParam.create({
          data: {
            ...scalars,
            tenantId,
            branchId,
            labTestId,
          } as Prisma.OpdTestResultParamUncheckedCreateInput,
        });
        paramId = createdParam.id;
      }

      const ranges = await tx.opdTestReferenceRange.findMany({
        where: { paramId: param.id, tenantId: srcTenantId, deletedAt: null },
      });
      if (ranges.length) {
        await tx.opdTestReferenceRange.createMany({
          data: ranges.map((r) => ({
            ...this.stripMeta(r),
            tenantId,
            branchId,
            labTestId,
            paramId,
          })),
        });
      }
      const values = await tx.opdTestReferenceValue.findMany({
        where: { paramId: param.id, tenantId: srcTenantId, deletedAt: null },
      });
      if (values.length) {
        await tx.opdTestReferenceValue.createMany({
          data: values.map((v) => ({
            ...this.stripMeta(v),
            tenantId,
            branchId,
            labTestId,
            paramId,
          })) as Prisma.OpdTestReferenceValueCreateManyInput[],
        });
      }
    }

    const droppedIds = existingParams
      .map((p) => p.id)
      .filter((id) => !matchedIds.has(id));
    if (droppedIds.length) {
      const now = new Date();
      await tx.opdTestResultParam.updateMany({
        where: { id: { in: droppedIds } },
        data: { deletedAt: now },
      });
      await tx.opdTestReferenceRange.updateMany({
        where: { paramId: { in: droppedIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.opdTestReferenceValue.updateMany({
        where: { paramId: { in: droppedIds }, deletedAt: null },
        data: { deletedAt: now },
      });
    }
  }

  // ── Site Admin global templates ─────────────────────────────────────────────────

  /**
   * Create a SITE_ADMIN global template opd test (no tenant/branch/master
   * data). Forces the tenant-FK classification refs NULL and `isMandatoryTest`
   * false. Runs in a plain transaction. Seeds `versionHistory` v1.
   * @param actorId site-admin id recorded as `modifiedBy` on v1 (or null)
   * @param dto validated payload (classification refs ignored)
   */
  async createTemplate(
    actorId: string | null,
    dto: CreateOpdTestDto,
  ): Promise<OpdTestWithChildren> {
    this.assertCoreInvariants({
      priceMsrp: dto.priceMsrp ?? 0,
      priceMaximum: dto.priceMaximum ?? 0,
      priceMinimum: dto.priceMinimum ?? 0,
      isMandatoryTest: false,
      mandatoryDeptId: null,
      isRepeatIntervalRestriction: dto.isRepeatIntervalRestriction ?? false,
      repeatIntervalValue: dto.repeatIntervalValue ?? null,
      repeatIntervalUnit: dto.repeatIntervalUnit ?? null,
    });
    (dto.resultParams ?? []).forEach((p) => this.assertParam(p));
    this.assertFormulaSet(dto.resultParams ?? []);

    const { samples, resultParams, ...scalars } = dto;
    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(async (tx) => {
        const test = await tx.opdTest.create({
          data: {
            ...scalars,
            ...TEMPLATE_NULLED_REFS,
            tenantId: null,
            branchId: null,
            masterDataId: null,
            source: DataSource.SITE_ADMIN,
            versionHistory: [
              this.seedVersion(actorId),
            ] as unknown as Prisma.InputJsonValue,
          },
        });
        await this.createSamples(tx, null, null, test.id, samples);
        await this.createParams(tx, null, null, test.id, resultParams);
        return test.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.testName, dto.testCode);
      throw e;
    }
    return this.findTemplateById(createdId);
  }

  /**
   * List SITE_ADMIN template opd tests for the configurable listing screen.
   * Supports `search`, `status`, the same `view` projection, and (for the business
   * import picker) `isImported`/`notImportedOnly` annotation.
   * @param query view + search + status + pagination
   * @param tenantId caller tenant (present only on the business browse path)
   */
  async findAllTemplates(
    query: BrowseOpdTestTemplatesDto = {},
    tenantId?: string,
  ): Promise<PaginatedResult<ImportableTemplateRow>> {
    const view = query.view ?? OpdTestListView.DEFAULT;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.OpdTestWhereInput = {
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
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }

    let importedTemplateIds = new Set<string>();
    if (tenantId && query.masterDataId) {
      await this.masterDataService.findById(query.masterDataId, tenantId);
      const imported = await this.prisma.opdTest.findMany({
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
      this.prisma.opdTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.opdTest.count({ where }),
    ]);
    const rows = await this.projectListRows(view, null, tests);
    const data: ImportableTemplateRow[] = rows.map((row) => ({
      ...row,
      isImported: importedTemplateIds.has(row.id),
    }));
    return { data, total, page, limit };
  }

  /**
   * Fetch one SITE_ADMIN template opd test composed with its children.
   * @param labTestId template id
   * @throws OpdTestNotFoundException if missing/soft-deleted/not a template
   */
  async findTemplateById(labTestId: string): Promise<OpdTestWithChildren> {
    const test = await this.findCoreTemplateById(labTestId);
    return this.composeWithChildren(test);
  }

  /**
   * Update a SITE_ADMIN template opd test (child-replacement semantics).
   * Classification refs stay NULL. Runs in a plain transaction.
   * @param labTestId template id
   * @param dto partial update (classification refs ignored)
   */
  async updateTemplate(
    labTestId: string,
    dto: UpdateOpdTestDto,
  ): Promise<OpdTestWithChildren> {
    const existing = await this.findCoreTemplateById(labTestId);
    this.assertCoreInvariants({
      priceMsrp: dto.priceMsrp ?? existing.priceMsrp,
      priceMaximum: dto.priceMaximum ?? existing.priceMaximum,
      priceMinimum: dto.priceMinimum ?? existing.priceMinimum,
      isMandatoryTest: false,
      mandatoryDeptId: null,
      isRepeatIntervalRestriction:
        dto.isRepeatIntervalRestriction ?? existing.isRepeatIntervalRestriction,
      repeatIntervalValue:
        dto.repeatIntervalValue ?? existing.repeatIntervalValue ?? null,
      repeatIntervalUnit:
        dto.repeatIntervalUnit ?? existing.repeatIntervalUnit ?? null,
    });
    (dto.resultParams ?? []).forEach((p) => this.assertParam(p));
    this.assertFormulaSet(dto.resultParams ?? []);

    const { samples, resultParams, ...scalars } = dto;
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.opdTest.update({
          where: { id: labTestId },
          data: { ...scalars, ...TEMPLATE_NULLED_REFS },
        });
        if (samples !== undefined) {
          await tx.opdTestSample.updateMany({
            where: { labTestId, tenantId: null, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createSamples(tx, null, null, labTestId, samples);
        }
        if (resultParams !== undefined) {
          await tx.opdTestReferenceRange.updateMany({
            where: { labTestId, tenantId: null, deletedAt: null },
            data: { deletedAt: now },
          });
          await tx.opdTestReferenceValue.updateMany({
            where: { labTestId, tenantId: null, deletedAt: null },
            data: { deletedAt: now },
          });
          await tx.opdTestResultParam.updateMany({
            where: { labTestId, tenantId: null, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createParams(tx, null, null, labTestId, resultParams);
        }
      });
    } catch (e) {
      this.rethrowConflict(e, dto.testName ?? '', dto.testCode ?? '');
      throw e;
    }
    return this.findTemplateById(labTestId);
  }

  /**
   * Soft-delete a SITE_ADMIN template opd test and cascade soft-delete its
   * children, in one transaction.
   * @param labTestId template id
   * @throws OpdTestNotFoundException if missing/soft-deleted/not a template
   */
  async removeTemplate(labTestId: string): Promise<OpdTest> {
    await this.findCoreTemplateById(labTestId);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const where = { labTestId, tenantId: null, deletedAt: null };
      await tx.opdTestReferenceRange.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.opdTestReferenceValue.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.opdTestResultParam.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.opdTestSample.updateMany({ where, data: { deletedAt: now } });
      return tx.opdTest.update({
        where: { id: labTestId },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Clone a SITE_ADMIN template opd test into a tenant's catalogue. `tenantId`
   * from the JWT; `branchId` from the target master data; only `masterDataId` is
   * client-supplied. Fully transactional.
   * @param templateId the SITE_ADMIN template to clone
   * @param tenantId caller's tenant
   * @param masterDataId target master data (validated against the tenant)
   */
  async cloneToTenant(
    templateId: string,
    tenantId: string,
    masterDataId: string,
  ): Promise<OpdTestWithChildren> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );
    const template = await this.findCoreTemplateById(templateId);
    let newId: string;
    try {
      newId = await this.prisma.withTenant(tenantId, async (tx) => {
        const createdTest = await this.clonePersistTest(tx, template, {
          tenantId,
          branchId: masterData.branchId,
          masterDataId,
          source: DataSource.TENANT,
          actorId: null,
        });
        return createdTest.id;
      });
    } catch (e) {
      this.rethrowConflict(e, template.testName, template.testCode);
      throw e;
    }
    return this.findById(masterDataId, newId, tenantId);
  }

  /**
   * Bulk-import SITE_ADMIN template opd tests into a tenant's master data.
   * Each template is imported in its own transaction. Already-imported templates
   * are skipped; missing/deleted templates and conflicts are reported as failures.
   * @param tenantId tenant scope (from the JWT)
   * @param actorId person recorded on the seed version (or null)
   * @param dto target master data + SITE_ADMIN template ids
   */
  async importTemplates(
    tenantId: string,
    actorId: string | null,
    dto: ImportOpdTestTemplatesDto,
  ): Promise<OpdTestImportResult> {
    const masterData = await this.masterDataService.findById(
      dto.masterDataId,
      tenantId,
    );
    const templates = await this.prisma.opdTest.findMany({
      where: {
        id: { in: dto.templateIds },
        source: DataSource.SITE_ADMIN,
        deletedAt: null,
      },
    });
    const templateById = new Map(templates.map((t) => [t.id, t]));
    const already = await this.prisma.opdTest.findMany({
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

    const result: OpdTestImportResult = {
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
        const newId = await this.prisma.withTenant(tenantId, async (tx) => {
          const createdTest = await this.clonePersistTest(tx, template, {
            tenantId,
            branchId: masterData.branchId,
            masterDataId: dto.masterDataId,
            source: DataSource.TENANT,
            actorId,
          });
          return createdTest.id;
        });
        result.imported.push({
          templateId,
          labTestId: newId,
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
   * Re-pull previously-imported opd tests from their SITE_ADMIN templates.
   * The tenant copy's scalars are replaced (version bumped); samples rebuilt; params
   * matched-and-patched. Hand-created tests (`clonedFromId = null`) are untouched.
   * Each test is synced in its own transaction.
   * @param tenantId tenant scope (from the JWT)
   * @param actorId person recorded on the bumped version (or null)
   * @param dto master data + optional subset of tenant test ids
   */
  async syncTemplates(
    tenantId: string,
    actorId: string | null,
    dto: SyncOpdTestTemplatesDto,
  ): Promise<OpdTestSyncResult> {
    await this.masterDataService.findById(dto.masterDataId, tenantId);
    const where: Prisma.OpdTestWhereInput = {
      tenantId,
      masterDataId: dto.masterDataId,
      clonedFromId: { not: null },
      deletedAt: null,
    };
    if (dto.labTestIds?.length) {
      where.id = { in: dto.labTestIds };
    }
    const tests = await this.prisma.opdTest.findMany({ where });

    const result: OpdTestSyncResult = {
      synced: [],
      skipped: [],
      failed: [],
    };
    for (const test of tests) {
      const templateId = test.clonedFromId;
      if (!templateId) {
        continue;
      }
      const template = await this.prisma.opdTest.findFirst({
        where: {
          id: templateId,
          source: DataSource.SITE_ADMIN,
          deletedAt: null,
        },
      });
      if (!template) {
        result.skipped.push({
          labTestId: test.id,
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
          await tx.opdTest.update({
            where: { id: test.id },
            data: {
              ...this.stripMeta(template),
              templateSyncedAt: new Date(),
              versionHistory: history as unknown as Prisma.InputJsonValue,
            },
          });
          await tx.opdTestSample.deleteMany({
            where: { labTestId: test.id, tenantId },
          });
          await this.upsertTestChildren(tx, template.id, template.tenantId, {
            tenantId,
            branchId: test.branchId,
            labTestId: test.id,
          });
        });
        result.synced.push({
          labTestId: test.id,
          testName: template.testName,
          templateId,
        });
      } catch (e) {
        result.failed.push({
          labTestId: test.id,
          testName: test.testName,
          templateId,
          reason: this.conflictReason(e, template.testName, template.testCode),
        });
      }
    }
    return result;
  }

  /**
   * Clone a SITE_ADMIN template opd test into a tenant within an EXISTING
   * transaction — used by `OpdPanelService` when adopting a template panel.
   * Returns the new TENANT test row.
   * @param tx the caller's transaction client (already in `withTenant`)
   * @param templateId the SITE_ADMIN template test to clone
   * @param target tenant/branch/master data for the new test
   * @throws OpdTestNotFoundException if `templateId` is not a live template
   */
  async cloneTemplateTestWithinTx(
    tx: Prisma.TransactionClient,
    templateId: string,
    target: { tenantId: string; branchId: string | null; masterDataId: string },
  ): Promise<OpdTest> {
    const template = await tx.opdTest.findFirst({
      where: { id: templateId, source: DataSource.SITE_ADMIN, deletedAt: null },
    });
    if (!template) {
      throw new OpdTestNotFoundException(templateId);
    }
    return this.clonePersistTest(tx, template, {
      tenantId: target.tenantId,
      branchId: target.branchId,
      masterDataId: target.masterDataId,
      source: DataSource.TENANT,
      actorId: null,
    });
  }

  /**
   * Fetch one active SITE_ADMIN template opd test (core row only).
   * @throws OpdTestNotFoundException if missing/soft-deleted/not a template
   */
  private async findCoreTemplateById(labTestId: string): Promise<OpdTest> {
    const test = await this.prisma.opdTest.findFirst({
      where: { id: labTestId, source: DataSource.SITE_ADMIN, deletedAt: null },
    });
    if (!test) {
      throw new OpdTestNotFoundException(labTestId);
    }
    return test;
  }

  /**
   * Bulk-edit opd tests: apply each item's scalar changes to its own `labTestId`
   * (all scoped to the caller's tenant + the path's master data). All-or-nothing.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param dto the array of per-test edits
   * @returns the number of tests updated
   */
  async bulkEdit(
    masterDataId: string,
    tenantId: string,
    dto: BulkEditOpdTestsDto,
  ): Promise<BulkEditResult> {
    await this.masterDataService.findById(masterDataId, tenantId);

    const items = dto.data;
    const ids = items.map((i) => i.labTestId);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationException('Duplicate labTestId in payload');
    }

    const edits = items.map((item) => {
      const { labTestId, ...changes } = item;
      const data = this.pickDefined(changes);
      if (Object.keys(data).length === 0) {
        throw new ValidationException(
          `No changes provided for opd test ${labTestId}`,
        );
      }
      return { labTestId, changes, data };
    });

    const tests = await this.prisma.opdTest.findMany({
      where: { id: { in: ids }, masterDataId, tenantId, deletedAt: null },
    });
    const testById = new Map(tests.map((t) => [t.id, t]));
    const missing = ids.find((id) => !testById.has(id));
    if (missing) {
      throw new OpdTestNotFoundException(missing);
    }

    for (const { labTestId, changes } of edits) {
      const test = testById.get(labTestId)!;
      this.assertCoreInvariants({
        priceMsrp: changes.priceMsrp ?? test.priceMsrp,
        priceMaximum: changes.priceMaximum ?? test.priceMaximum,
        priceMinimum: changes.priceMinimum ?? test.priceMinimum,
        isMandatoryTest: changes.isMandatoryTest ?? test.isMandatoryTest,
        mandatoryDeptId:
          changes.mandatoryDeptId ?? test.mandatoryDeptId ?? null,
        isRepeatIntervalRestriction:
          changes.isRepeatIntervalRestriction ??
          test.isRepeatIntervalRestriction,
        repeatIntervalValue:
          changes.repeatIntervalValue ?? test.repeatIntervalValue ?? null,
        repeatIntervalUnit:
          changes.repeatIntervalUnit ?? test.repeatIntervalUnit ?? null,
      });
      await this.assertCatalogueRefs(tenantId, {
        departmentId: changes.departmentId,
        categoryId: changes.categoryId,
        subCategoryId: changes.subCategoryId,
        mandatoryDeptId: changes.mandatoryDeptId,
        mandatoryCatId: changes.mandatoryCatId,
        mandatorySubcatId: changes.mandatorySubcatId,
      });
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      for (const { labTestId, data } of edits) {
        await tx.opdTest.update({ where: { id: labTestId }, data });
      }
    });
    return { updated: edits.length };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /** Strip undefined keys from one bulk-edit item's changes, yielding a Prisma update. */
  private pickDefined(
    changes: Record<string, unknown>,
  ): Prisma.OpdTestUpdateInput {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * Fetch one active opd test (core row only) scoped to its tenant + master data.
   * @throws OpdTestNotFoundException if missing/soft-deleted/other master data
   */
  private async findCoreById(
    labTestId: string,
    masterDataId: string,
    tenantId: string,
  ): Promise<OpdTest> {
    const test = await this.prisma.opdTest.findFirst({
      where: { id: labTestId, masterDataId, tenantId, deletedAt: null },
    });
    if (!test) {
      throw new OpdTestNotFoundException(labTestId);
    }
    return test;
  }

  /**
   * Insert a test's sample rows (no-op for an empty/absent list). `tenantId` /
   * `branchId` are NULL when the parent test is a SITE_ADMIN template.
   */
  private async createSamples(
    tx: Prisma.TransactionClient,
    tenantId: string | null,
    branchId: string | null,
    labTestId: string,
    samples: CreateOpdTestDto['samples'] | undefined,
  ): Promise<void> {
    if (!samples?.length) {
      return;
    }
    await tx.opdTestSample.createMany({
      data: samples.map((s) => ({ ...s, tenantId, branchId, labTestId })),
    });
  }

  /**
   * Insert a test's result parameters and, per parameter, its reference
   * ranges/values (mapped to the freshly-created `paramId`).
   */
  private async createParams(
    tx: Prisma.TransactionClient,
    tenantId: string | null,
    branchId: string | null,
    labTestId: string,
    params: OpdTestResultParamDto[] | undefined,
  ): Promise<void> {
    for (const p of params ?? []) {
      const { referenceRanges, referenceValues, reflexTests, ...paramScalars } =
        p;
      const param = await tx.opdTestResultParam.create({
        data: {
          ...paramScalars,
          reflexTests: (reflexTests ?? []) as unknown as Prisma.InputJsonValue,
          tenantId,
          branchId,
          labTestId,
        },
      });
      if (referenceRanges?.length) {
        await tx.opdTestReferenceRange.createMany({
          data: referenceRanges.map((r) => ({
            ...r,
            tenantId,
            branchId,
            labTestId,
            paramId: param.id,
          })),
        });
      }
      if (referenceValues?.length) {
        await tx.opdTestReferenceValue.createMany({
          data: referenceValues.map((v) => ({
            ...v,
            tenantId,
            branchId,
            labTestId,
            paramId: param.id,
          })),
        });
      }
    }
  }

  /**
   * Replace a test's result parameters while preserving the DB `id` of any
   * parameter whose `parameterCode` (case-insensitive) matches one already active
   * on this test — other modules hold logical references to
   * `OpdTestResultParam.id`. A matched param's scalars are patched and its
   * ranges/values fully replaced; an unmatched incoming code creates a new param;
   * an existing active param whose code no longer appears is soft-deleted.
   */
  private async upsertParamsByCode(
    tx: Prisma.TransactionClient,
    tenantId: string | null,
    branchId: string | null,
    labTestId: string,
    params: OpdTestResultParamDto[] | undefined,
    now: Date,
  ): Promise<void> {
    const existing = await tx.opdTestResultParam.findMany({
      where: { labTestId, tenantId, deletedAt: null },
      select: { id: true, parameterCode: true },
    });
    const existingByCode = new Map(
      existing.map((p) => [p.parameterCode.toLowerCase(), p.id]),
    );
    const matchedIds = new Set<string>();

    for (const p of params ?? []) {
      const { referenceRanges, referenceValues, reflexTests, ...paramScalars } =
        p;
      const existingId = existingByCode.get(p.parameterCode.toLowerCase());

      let paramId: string;
      if (existingId) {
        matchedIds.add(existingId);
        await tx.opdTestResultParam.update({
          where: { id: existingId },
          data: {
            ...paramScalars,
            reflexTests: (reflexTests ??
              []) as unknown as Prisma.InputJsonValue,
          },
        });
        paramId = existingId;
        await tx.opdTestReferenceRange.updateMany({
          where: { paramId, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.opdTestReferenceValue.updateMany({
          where: { paramId, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
      } else {
        const createdParam = await tx.opdTestResultParam.create({
          data: {
            ...paramScalars,
            reflexTests: (reflexTests ??
              []) as unknown as Prisma.InputJsonValue,
            tenantId,
            branchId,
            labTestId,
          },
        });
        paramId = createdParam.id;
      }

      if (referenceRanges?.length) {
        await tx.opdTestReferenceRange.createMany({
          data: referenceRanges.map((r) => ({
            ...r,
            tenantId,
            branchId,
            labTestId,
            paramId,
          })),
        });
      }
      if (referenceValues?.length) {
        await tx.opdTestReferenceValue.createMany({
          data: referenceValues.map((v) => ({
            ...v,
            tenantId,
            branchId,
            labTestId,
            paramId,
          })),
        });
      }
    }

    const droppedIds = existing
      .map((p) => p.id)
      .filter((id) => !matchedIds.has(id));
    if (droppedIds.length) {
      await tx.opdTestResultParam.updateMany({
        where: { id: { in: droppedIds } },
        data: { deletedAt: now },
      });
      await tx.opdTestReferenceRange.updateMany({
        where: { paramId: { in: droppedIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.opdTestReferenceValue.updateMany({
        where: { paramId: { in: droppedIds }, deletedAt: null },
        data: { deletedAt: now },
      });
    }
  }

  /** A shallow copy of a row with the re-derived meta keys removed (for cloning). */
  private stripMeta(row: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...row };
    for (const key of META_KEYS) {
      delete copy[key];
    }
    return copy;
  }

  /** Build the seed v1 version entry for a freshly-created test. */
  private seedVersion(actorId: string | null): OpdTestVersionEntry {
    return {
      version: 1,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: null,
      modifiedBy: actorId,
      approvedBy: null,
    };
  }

  /** Read a opd test's `versionHistory` Json into a typed, mutable array. */
  private readVersionHistory(value: Prisma.JsonValue): OpdTestVersionEntry[] {
    return Array.isArray(value)
      ? (value as unknown as OpdTestVersionEntry[])
      : [];
  }

  /** The day before a `YYYY-MM-DD` date, as `YYYY-MM-DD` (UTC). */
  private previousDay(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /** Validate cross-field invariants that class-validator can't express per-field. */
  private assertCoreInvariants(c: {
    priceMsrp: number;
    priceMaximum: number;
    priceMinimum: number;
    isMandatoryTest: boolean;
    mandatoryDeptId: string | null;
    isRepeatIntervalRestriction: boolean;
    repeatIntervalValue: number | null;
    repeatIntervalUnit: string | null;
  }): void {
    if (c.priceMaximum > c.priceMsrp) {
      throw new ValidationException('Price Maximum must be ≤ Price MSRP', {
        priceMaximum: String(c.priceMaximum),
        priceMsrp: String(c.priceMsrp),
      });
    }
    if (c.priceMinimum > c.priceMaximum) {
      throw new ValidationException('Price Minimum must be ≤ Price Maximum', {
        priceMinimum: String(c.priceMinimum),
        priceMaximum: String(c.priceMaximum),
      });
    }
    if (c.isMandatoryTest && !c.mandatoryDeptId) {
      throw new ValidationException(
        'Mandatory Department is required when Mandatory Test is Yes',
        { mandatoryDeptId: 'missing' },
      );
    }
    if (
      c.isRepeatIntervalRestriction &&
      (c.repeatIntervalValue == null || c.repeatIntervalUnit == null)
    ) {
      throw new ValidationException(
        'Repeat Interval Value and Repeat Interval Unit are required when Repeat Interval Restriction is Yes',
        { repeatIntervalValue: 'missing', repeatIntervalUnit: 'missing' },
      );
    }
  }

  /**
   * Check whether a catalogue row (department / category / sub-category) exists as
   * an active row of the given tenant.
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
   * Validate that any provided classification / mandatory-test catalogue refs point
   * at an active row of the caller's tenant. These are logical refs, so an unknown
   * id should surface as a clean 400.
   * @throws ValidationException if a provided id is not a live row of this tenant
   */
  private async assertCatalogueRefs(
    tenantId: string,
    refs: {
      departmentId?: string | null;
      categoryId?: string | null;
      subCategoryId?: string | null;
      mandatoryDeptId?: string | null;
      mandatoryCatId?: string | null;
      mandatorySubcatId?: string | null;
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
      [refs.mandatoryDeptId, 'department', 'mandatoryDeptId', 'department'],
      [refs.mandatoryCatId, 'category', 'mandatoryCatId', 'category'],
      [
        refs.mandatorySubcatId,
        'subCategory',
        'mandatorySubcatId',
        'sub-category',
      ],
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

  /** Validate a result parameter + its embedded reference ranges. */
  private assertParam(p: OpdTestResultParamDto): void {
    if (
      p.criticalMin != null &&
      p.criticalMax != null &&
      p.criticalMin > p.criticalMax
    ) {
      throw new ValidationException('criticalMin must be ≤ criticalMax', {
        parameterCode: p.parameterCode,
      });
    }
    (p.referenceRanges ?? []).forEach((r) => this.assertRange(r));
  }

  /**
   * Validate the calculated-parameter formulas across a test's whole parameter set:
   * syntax, references, and no dependency cycle. References are scoped to this test.
   * @throws InvalidFormulaException / UnknownFormulaReferenceException / CircularFormulaDependencyException
   */
  private assertFormulaSet(params: OpdTestResultParamDto[]): void {
    const formulaParams: FormulaParam[] = params.map((p) => ({
      code: p.parameterCode,
      isCalculated:
        p.parameterType === ParameterType.CALCULATED ||
        !!p.calculationFormula?.trim(),
      formula: p.calculationFormula,
    }));
    const result = validateFormulaSet(formulaParams);
    if (result.ok) return;
    switch (result.kind) {
      case 'SYNTAX':
        throw new InvalidFormulaException(result.code, 'syntax');
      case 'SELF_REF':
        throw new InvalidFormulaException(result.code, 'self');
      case 'UNKNOWN_REF':
        throw new UnknownFormulaReferenceException(result.code, result.ref);
      case 'CYCLE':
        throw new CircularFormulaDependencyException(result.cycle);
    }
  }

  /** Validate a numeric reference range's bounds. */
  private assertRange(r: OpdTestReferenceRangeDto): void {
    if (
      r.lowerLimit != null &&
      r.upperLimit != null &&
      r.lowerLimit > r.upperLimit
    ) {
      throw new ValidationException('lowerLimit must be ≤ upperLimit');
    }
    if (
      r.criticalMin != null &&
      r.lowerLimit != null &&
      r.criticalMin > r.lowerLimit
    ) {
      throw new ValidationException('criticalMin must be ≤ lowerLimit');
    }
    if (
      r.criticalMax != null &&
      r.upperLimit != null &&
      r.criticalMax < r.upperLimit
    ) {
      throw new ValidationException('criticalMax must be ≥ upperLimit');
    }
    if ((r.ageFrom ?? 0) > (r.ageTo ?? 999)) {
      throw new ValidationException('ageFrom must be ≤ ageTo');
    }
  }

  /**
   * Map a Prisma unique-constraint violation (P2002) to the matching typed 409.
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
    if (target.includes('parameter_code')) {
      throw new OpdTestParamCodeConflictException('');
    }
    if (target.includes('test_code')) {
      throw new OpdTestCodeConflictException(testCode);
    }
    throw new OpdTestNameConflictException(testName);
  }

  /**
   * Human-readable reason for a per-row import/sync failure.
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
      if (target.includes('parameter_code')) {
        return 'A result parameter code already exists in this master data';
      }
      if (target.includes('test_code')) {
        return `Test code "${testCode}" already exists in this master data`;
      }
      return `Test name "${testName}" already exists in this master data`;
    }
    return 'Unexpected error while importing this test';
  }
}
