import { Injectable } from '@nestjs/common';
import {
  DataSource,
  LabTest,
  LabTestReferenceRange,
  LabTestReferenceValue,
  LabTestResultParam,
  LabTestSample,
  ParameterType,
  Prisma,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { MasterDataService } from '../master-data/master-data.service';
import { CreateLabTestDto } from './dto/create-lab-test.dto';
import { UpdateLabTestDto } from './dto/update-lab-test.dto';
import { ListLabTestsDto } from './dto/list-lab-tests.dto';
import { LabTestResultParamDto } from './dto/lab-test-result-param.dto';
import { LabTestReferenceRangeDto } from './dto/lab-test-reference-range.dto';
import { AddLabTestVersionDto } from './dto/add-lab-test-version.dto';
import {
  BulkEditLabTestItemDto,
  BulkEditLabTestsDto,
} from './dto/bulk-edit-lab-tests.dto';
import {
  ImportLabTestRowDto,
  ImportLabTestsDto,
} from './dto/import-lab-tests.dto';
import {
  LabTestListRow,
  LabTestListView,
  LabTestRefRangeRow,
  LabTestRefValueRow,
  LabTestResultsParamRow,
  LabTestSampleRow,
  LabTestVersionEntry,
  LabTestWithChildren,
  ReflexTestRef,
} from './entities/lab-test.entity';
import {
  LabTestCodeConflictException,
  LabTestImportValidationException,
  LabTestNameConflictException,
  LabTestNotFoundException,
  LabTestParamCodeConflictException,
} from './exceptions/lab-test.exceptions';

/** Result of a bulk edit: how many lab tests were updated. */
export interface BulkEditResult {
  updated: number;
}

/** Result of a bulk import: how many lab tests were created. */
export interface ImportResult {
  created: number;
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
  'createdAt',
  'updatedAt',
  'deletedAt',
  'versionHistory',
];

/**
 * Classification / mandatory-test refs that are real FKs to tenant-scoped
 * catalogue tables (departments / categories / sub_categories). A SITE_ADMIN
 * global template belongs to no tenant, so it cannot reference them — these are
 * forced NULL (and `isMandatoryTest` forced false) when creating/updating a
 * template, so they are intentionally absent from the template write payload.
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
 * Lab-test configuration management. Tenant-scoped + branch-level; every test
 * lives inside a master data (`masterDataId`) whose tenant/branch it inherits.
 * Child rows (samples, result params, reference ranges/values) are managed
 * nested in the test payload. Prisma-direct; multi-step writes run in
 * `withTenant` transactions. Cross-field invariants are validated here (defence
 * in front of the CHECK constraints in prisma/rls.sql).
 */
@Injectable()
export class LabTestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterDataService: MasterDataService,
  ) {}

  /**
   * Create a lab test inside a master data, with its samples and result
   * parameters (each carrying its reference ranges/values). The master data is
   * validated to belong to the caller's tenant (and supplies `branchId`).
   * Seeds `versionHistory` with v1. All inserts run in one transaction.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param actorId person id recorded as `modifiedBy` on the seeded v1
   * @param dto validated payload
   * @returns the created lab test with all children
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws ValidationException on a cross-field invariant violation
   * @throws LabTestNameConflictException / LabTestCodeConflictException / LabTestParamCodeConflictException
   */
  async create(
    masterDataId: string,
    tenantId: string,
    actorId: string,
    dto: CreateLabTestDto,
  ): Promise<LabTestWithChildren> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );
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

    const { samples, resultParams, ...scalars } = dto;
    let createdId: string;
    try {
      createdId = await this.prisma.withTenant(tenantId, async (tx) => {
        const labTest = await tx.labTest.create({
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
          labTest.id,
          samples,
        );
        await this.createParams(
          tx,
          tenantId,
          masterData.branchId,
          labTest.id,
          resultParams,
        );
        return labTest.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.testName, dto.testCode);
      throw e;
    }
    return this.findById(masterDataId, createdId, tenantId);
  }

  /**
   * Fetch one lab test composed with its samples and result parameters (each
   * with its reference ranges/values).
   * @param masterDataId parent master data id
   * @param labTestId lab test id
   * @param tenantId tenant scope
   * @throws LabTestNotFoundException if missing/soft-deleted/other master data
   */
  async findById(
    masterDataId: string,
    labTestId: string,
    tenantId: string,
  ): Promise<LabTestWithChildren> {
    const labTest = await this.findCoreById(labTestId, masterDataId, tenantId);
    return this.composeWithChildren(labTest);
  }

  /**
   * Compose a (already-fetched) lab test with its samples and result parameters
   * (each with its reference ranges/values). Children are scoped to the test's
   * own `tenantId` — which is the caller's tenant for TENANT tests and NULL for
   * SITE_ADMIN templates — so this serves both the tenant and template read paths.
   * @param labTest the core lab-test row
   */
  private async composeWithChildren(
    labTest: LabTest,
  ): Promise<LabTestWithChildren> {
    const { id: labTestId, tenantId } = labTest;
    const [samples, params] = await Promise.all([
      this.prisma.labTestSample.findMany({
        where: { labTestId, tenantId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.labTestResultParam.findMany({
        where: { labTestId, tenantId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    const [ranges, values] = await Promise.all([
      this.prisma.labTestReferenceRange.findMany({
        where: { labTestId, tenantId, deletedAt: null },
      }),
      this.prisma.labTestReferenceValue.findMany({
        where: { labTestId, tenantId, deletedAt: null },
      }),
    ]);
    return {
      ...labTest,
      samples,
      resultParams: params.map((p) => ({
        ...p,
        referenceRanges: ranges.filter((r) => r.paramId === p.id),
        referenceValues: values.filter((v) => v.paramId === p.id),
        // `reflexTests` is stored as a JSON snapshot of { id, name } — returned
        // verbatim (Prisma types JSON columns as `JsonValue`).
        reflexTests: (p.reflexTests ?? []) as unknown as ReflexTestRef[],
      })),
    };
  }

  /**
   * Lightweight `{ id, name }` options for the searchable selector
   * (`GET /lab-tests/options`). Tenant-scoped to active, non-deleted lab tests;
   * optionally filtered by `branchId` and a case-insensitive `testName` search.
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
    const where: Prisma.LabTestWhereInput = {
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
      const rows = await this.prisma.labTest.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.testName }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.labTest.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.labTest.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.testName })),
      total,
      page,
      limit,
    };
  }

  /**
   * Lightweight `{ id, name }` options for **SITE_ADMIN template** lab tests
   * (`GET /siteadmin/lab-tests/options`) — the template equivalent of
   * `findOptions`, used by the SiteAdmin Test Groups multi-select. Filters active,
   * non-deleted templates (`source = SITE_ADMIN`, `tenantId = null`) by a
   * case-insensitive `testName` search. Returns the full array when `page` is
   * omitted, or a paginated envelope when `page` is supplied.
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
    const where: Prisma.LabTestWhereInput = {
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
      const rows = await this.prisma.labTest.findMany({
        where,
        select,
        orderBy,
      });
      return rows.map((r) => ({ id: r.id, name: r.testName }));
    }

    const page = filters.page;
    const limit = filters.limit ?? 20;
    const [rows, total] = await Promise.all([
      this.prisma.labTest.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.labTest.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, name: r.testName })),
      total,
      page,
      limit,
    };
  }

  /**
   * List active lab tests in a master data (offset pagination; core rows only).
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async findAll(
    masterDataId: string,
    tenantId: string,
    query: ListLabTestsDto = {},
  ): Promise<PaginatedResult<LabTest>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = await this.buildListWhere(masterDataId, tenantId, query);
    const [data, total] = await Promise.all([
      this.prisma.labTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.labTest.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Build the shared `where` clause for the lab-test list/listing endpoints:
   * tenant + master-data scope, `search` (testName/testCode), classification
   * filters, `sampleType` (via a child-sample subquery, since `LabTestSample`
   * has no Prisma relation back to the test), and `status` → `isActive`.
   */
  private async buildListWhere(
    masterDataId: string,
    tenantId: string,
    query: ListLabTestsDto,
  ): Promise<Prisma.LabTestWhereInput> {
    const where: Prisma.LabTestWhereInput = {
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
      const sampleRows = await this.prisma.labTestSample.findMany({
        where: { tenantId, sampleType, deletedAt: null },
        select: { labTestId: true },
      });
      where.id = { in: sampleRows.map((s) => s.labTestId) };
    }
    if (query.status) where.isActive = query.status === 'ACTIVE';
    return where;
  }

  /**
   * List lab tests in a master data for the configurable listing screen.
   * Supports search (by `testName`/`testCode`), classification + status filters,
   * and a `view` that projects a different column subset (and, for the
   * child-centric views, nested arrays). Pagination always counts lab tests.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param query view + filters + pagination
   * @returns a paginated list of view-specific projection rows
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async listForView(
    masterDataId: string,
    tenantId: string,
    query: ListLabTestsDto,
  ): Promise<PaginatedResult<LabTestListRow>> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const view = query.view ?? LabTestListView.DEFAULT;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = await this.buildListWhere(masterDataId, tenantId, query);

    const [tests, total] = await Promise.all([
      this.prisma.labTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.labTest.count({ where }),
    ]);

    const data = await this.projectListRows(view, tenantId, tests);
    return { data, total, page, limit };
  }

  // ── Listing projection ────────────────────────────────────────────────────────

  /**
   * Project a page of lab tests into the requested view's row shape. Fetches only
   * the children/counts/names the view needs, batched over the page's ids (no
   * N+1), then maps each test.
   */
  private async projectListRows(
    view: LabTestListView,
    tenantId: string | null,
    tests: LabTest[],
  ): Promise<LabTestListRow[]> {
    if (tests.length === 0) {
      return [];
    }
    const ids = tests.map((t) => t.id);

    switch (view) {
      case LabTestListView.DEFAULT: {
        const [deptNames, defaultSamples, paramCounts] = await Promise.all([
          this.resolveNames(
            'department',
            tenantId,
            tests.map((t) => t.departmentId),
          ),
          this.fetchDefaultSamples(tenantId, ids),
          this.countByTest('labTestResultParam', tenantId, ids),
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

      case LabTestListView.BASIC_DETAILS: {
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
          approvalWorkflowId: t.approvalWorkflowId,
          isMandatoryTest: t.isMandatoryTest,
          samplePriorityType: t.samplePriorityType,
          icdCode: t.icdCode,
          loincCode: t.loincCode,
        }));
      }

      case LabTestListView.PRICING:
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

      case LabTestListView.TAT:
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          tatMinValue: t.tatMinValue,
          tatMinUnit: t.tatMinUnit,
          tatMaxValue: t.tatMaxValue,
          tatMaxUnit: t.tatMaxUnit,
          scheduleFrom: t.scheduleFrom,
          scheduleTo: t.scheduleTo,
          procTimeMinValue: t.procTimeMinValue,
          procTimeMinUnit: t.procTimeMinUnit,
          procTimeMaxValue: t.procTimeMaxValue,
          procTimeMaxUnit: t.procTimeMaxUnit,
          approvalTimeFrom: t.approvalTimeFrom,
          approvalTimeTo: t.approvalTimeTo,
        }));

      case LabTestListView.FLAGS:
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          isHideInOrderScreen: t.isHideInOrderScreen,
          isEnableCms: t.isEnableCms,
          isPreferenceTest: t.isPreferenceTest,
          isActive: t.isActive,
        }));

      case LabTestListView.SAMPLE: {
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
            (s): LabTestSampleRow => ({
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

      case LabTestListView.RESULTS: {
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
            (p): LabTestResultsParamRow => ({
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

      case LabTestListView.REFERENCE_RANGE: {
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
              (r): LabTestRefRangeRow => {
                const param = paramMap.get(r.paramId);
                return {
                  id: r.id,
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

      case LabTestListView.REFERENCE_VALUE: {
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
              (v): LabTestRefValueRow => {
                const param = paramMap.get(v.paramId);
                return {
                  id: v.id,
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

      case LabTestListView.NOTES:
        return tests.map((t) => ({
          id: t.id,
          testName: t.testName,
          usefulFor: t.usefulFor,
          interpretationOfResults: t.interpretationOfResults,
          limitations: t.limitations,
          remarks: t.remarks,
          references: t.references,
        }));

      case LabTestListView.VERSION_CONTROL:
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

      case LabTestListView.OVERVIEW: {
        const [deptNames, sampleCounts, paramCounts] = await Promise.all([
          this.resolveNames(
            'department',
            tenantId,
            tests.map((t) => t.departmentId),
          ),
          this.countByTest('labTestSample', tenantId, ids),
          this.countByTest('labTestResultParam', tenantId, ids),
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
   * Resolve a set of classification ids to a `id → name` map (tenant-scoped).
   * Used to denormalise department/category/sub-category names into list rows.
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
    // Classification tables are tenant-scoped (non-null tenantId). We only get
    // here with ids when projecting a TENANT test (templates have null
    // classification → empty ids → early return above), so tenantId is a real
    // string; `?? undefined` just satisfies their non-nullable where type.
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
  ): Promise<Map<string, LabTestSample>> {
    const rows = await this.prisma.labTestSample.findMany({
      where: {
        labTestId: { in: ids },
        tenantId,
        deletedAt: null,
        isDefault: true,
      },
    });
    const map = new Map<string, LabTestSample>();
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
  ): Promise<Map<string, LabTestSample[]>> {
    const rows = await this.prisma.labTestSample.findMany({
      where: { labTestId: { in: ids }, tenantId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return this.groupByKey(rows, (r) => r.labTestId);
  }

  /** All active result parameters grouped by `labTestId`. */
  private async fetchParams(
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, LabTestResultParam[]>> {
    const rows = await this.prisma.labTestResultParam.findMany({
      where: { labTestId: { in: ids }, tenantId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return this.groupByKey(rows, (r) => r.labTestId);
  }

  /** All active reference ranges grouped by `labTestId`. */
  private async fetchRanges(
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, LabTestReferenceRange[]>> {
    const rows = await this.prisma.labTestReferenceRange.findMany({
      where: { labTestId: { in: ids }, tenantId, deletedAt: null },
    });
    return this.groupByKey(rows, (r) => r.labTestId);
  }

  /** All active reference values grouped by `labTestId`. */
  private async fetchValues(
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, LabTestReferenceValue[]>> {
    const rows = await this.prisma.labTestReferenceValue.findMany({
      where: { labTestId: { in: ids }, tenantId, deletedAt: null },
    });
    return this.groupByKey(rows, (r) => r.labTestId);
  }

  /** Count active child rows of one model per test, keyed by `labTestId`. */
  private async countByTest(
    model: 'labTestSample' | 'labTestResultParam',
    tenantId: string | null,
    ids: string[],
  ): Promise<Map<string, number>> {
    const where = { labTestId: { in: ids }, tenantId, deletedAt: null };
    const grouped =
      model === 'labTestSample'
        ? await this.prisma.labTestSample.groupBy({
            by: ['labTestId'],
            where,
            _count: { _all: true },
          })
        : await this.prisma.labTestResultParam.groupBy({
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

  /** Group an array of rows into a `key → rows[]` map (insertion order preserved). */
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

  /** Index a list of result parameters by their id (for range/value denormalisation). */
  private indexById(
    params: LabTestResultParam[],
  ): Map<string, LabTestResultParam> {
    const map = new Map<string, LabTestResultParam>();
    for (const p of params) {
      map.set(p.id, p);
    }
    return map;
  }

  /** The "current" version entry: the open one (`effectiveTo === null`) else the highest. */
  private currentVersion(
    history: LabTestVersionEntry[],
  ): LabTestVersionEntry | null {
    const open = history.find((e) => e.effectiveTo === null);
    if (open) {
      return open;
    }
    return history.reduce<LabTestVersionEntry | null>(
      (acc, e) => (!acc || e.version > acc.version ? e : acc),
      null,
    );
  }

  /**
   * Update a lab test. Core fields are patched; when `samples` or `resultParams`
   * is provided, that whole child set is replaced (old active rows soft-deleted,
   * the new set created) in one transaction.
   * @param masterDataId parent master data id
   * @param labTestId lab test id
   * @param tenantId tenant scope
   * @param dto partial update
   * @throws LabTestNotFoundException / ValidationException / conflict exceptions
   */
  async update(
    masterDataId: string,
    labTestId: string,
    tenantId: string,
    dto: UpdateLabTestDto,
  ): Promise<LabTestWithChildren> {
    const existing = await this.findCoreById(labTestId, masterDataId, tenantId);
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

    const { samples, resultParams, ...scalars } = dto;
    const now = new Date();
    try {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.labTest.update({
          where: { id: labTestId },
          data: scalars,
        });
        if (samples !== undefined) {
          await tx.labTestSample.updateMany({
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
          await tx.labTestReferenceRange.updateMany({
            where: { labTestId, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await tx.labTestReferenceValue.updateMany({
            where: { labTestId, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await tx.labTestResultParam.updateMany({
            where: { labTestId, tenantId, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createParams(
            tx,
            tenantId,
            existing.branchId,
            labTestId,
            resultParams,
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
   * Soft-delete a lab test and cascade soft-delete all of its children
   * (samples, params, reference ranges/values) in one transaction.
   * @param masterDataId parent master data id
   * @param labTestId lab test id
   * @param tenantId tenant scope
   * @throws LabTestNotFoundException if missing/soft-deleted/other master data
   */
  async remove(
    masterDataId: string,
    labTestId: string,
    tenantId: string,
  ): Promise<LabTest> {
    await this.findCoreById(labTestId, masterDataId, tenantId);
    const now = new Date();
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where = { labTestId, tenantId, deletedAt: null };
      await tx.labTestReferenceRange.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.labTestReferenceValue.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.labTestResultParam.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.labTestSample.updateMany({ where, data: { deletedAt: now } });
      return tx.labTest.update({
        where: { id: labTestId },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Append a version entry to a lab test's `versionHistory`. `version` auto-
   * increments; the previous open entry's `effectiveTo` is set to the new
   * `effectiveFrom − 1 day`; the new entry's `effectiveTo` is null.
   * @param masterDataId parent master data id
   * @param labTestId lab test id
   * @param tenantId tenant scope
   * @param actorId person id recorded as `modifiedBy`
   * @param dto effective-from (+ optional approver)
   * @throws LabTestNotFoundException if missing/soft-deleted/other master data
   */
  async addVersion(
    masterDataId: string,
    labTestId: string,
    tenantId: string,
    actorId: string,
    dto: AddLabTestVersionDto,
  ): Promise<LabTest> {
    const labTest = await this.findCoreById(labTestId, masterDataId, tenantId);
    const history = this.readVersionHistory(labTest.versionHistory);
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
    return this.prisma.labTest.update({
      where: { id: labTestId },
      data: { versionHistory: history as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Deep-clone all active lab tests from a source master data into a target
   * (both in the caller's tenant). Each test plus its samples, params, and
   * reference ranges/values is copied with fresh ids, the target's `branchId`,
   * and a fresh `versionHistory` v1. A source test is skipped if its `testName`
   * or `testCode` already exists (active) in the target.
   * @param sourceMasterDataId master data to copy from
   * @param targetMasterDataId master data to copy into
   * @param tenantId tenant scope
   * @returns counts of copied vs skipped tests
   * @throws MasterDataNotFoundException if either master data is missing/other tenant
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
      const sourceTests = await tx.labTest.findMany({
        where: { masterDataId: sourceMasterDataId, tenantId, deletedAt: null },
      });
      const existing = await tx.labTest.findMany({
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
   * Deep-copy one (already-loaded) lab test plus its samples, result params and
   * each param's reference ranges/values into a NEW test with fresh ids, the
   * given scope (`tenantId`/`branchId`/`masterDataId`/`source`) and a fresh
   * `versionHistory` v1. Child rows are read from the SOURCE's own scope
   * (`src.tenantId`) — which is NULL for a SITE_ADMIN template — so this serves
   * both tenant→tenant cloning and SITE_ADMIN→tenant template adoption. Runs
   * inside the caller's transaction (`tx`); the caller owns commit/rollback.
   * @returns the newly-created lab test core row
   */
  private async clonePersistTest(
    tx: Prisma.TransactionClient,
    src: LabTest,
    target: {
      tenantId: string | null;
      branchId: string | null;
      masterDataId: string | null;
      source: DataSource;
      actorId: string | null;
    },
  ): Promise<LabTest> {
    const { tenantId, branchId, masterDataId, source, actorId } = target;
    const srcTenantId = src.tenantId;
    const newTest = await tx.labTest.create({
      data: {
        ...this.stripMeta(src),
        tenantId,
        branchId,
        masterDataId,
        source,
        versionHistory: [
          this.seedVersion(actorId),
        ] as unknown as Prisma.InputJsonValue,
      } as Prisma.LabTestUncheckedCreateInput,
    });

    const samples = await tx.labTestSample.findMany({
      where: { labTestId: src.id, tenantId: srcTenantId, deletedAt: null },
    });
    if (samples.length) {
      await tx.labTestSample.createMany({
        data: samples.map((s) => ({
          ...this.stripMeta(s),
          tenantId,
          branchId,
          labTestId: newTest.id,
        })),
      });
    }

    const params = await tx.labTestResultParam.findMany({
      where: { labTestId: src.id, tenantId: srcTenantId, deletedAt: null },
    });
    for (const param of params) {
      const newParam = await tx.labTestResultParam.create({
        data: {
          ...this.stripMeta(param),
          tenantId,
          branchId,
          labTestId: newTest.id,
        } as Prisma.LabTestResultParamUncheckedCreateInput,
      });
      const ranges = await tx.labTestReferenceRange.findMany({
        where: { paramId: param.id, tenantId: srcTenantId, deletedAt: null },
      });
      if (ranges.length) {
        await tx.labTestReferenceRange.createMany({
          data: ranges.map((r) => ({
            ...this.stripMeta(r),
            tenantId,
            branchId,
            labTestId: newTest.id,
            paramId: newParam.id,
          })),
        });
      }
      const values = await tx.labTestReferenceValue.findMany({
        where: { paramId: param.id, tenantId: srcTenantId, deletedAt: null },
      });
      if (values.length) {
        await tx.labTestReferenceValue.createMany({
          data: values.map((v) => ({
            ...this.stripMeta(v),
            tenantId,
            branchId,
            labTestId: newTest.id,
            paramId: newParam.id,
          })) as Prisma.LabTestReferenceValueCreateManyInput[],
        });
      }
    }
    return newTest;
  }

  // ── Site Admin global templates ─────────────────────────────────────────────────

  /**
   * Create a SITE_ADMIN global template lab test (no tenant/branch/master data).
   * Reuses `CreateLabTestDto` but forces the tenant-FK classification refs NULL
   * (departments/categories/sub-categories are tenant-scoped, so a global
   * template can't reference them) and `isMandatoryTest` false. Children are
   * created with NULL tenant/branch. There is no tenant GUC, so this runs in a
   * plain transaction (RLS lets a GUC-less SiteAdmin connection write NULL-tenant
   * rows). Seeds `versionHistory` v1.
   * @param actorId site-admin id recorded as `modifiedBy` on v1 (or null)
   * @param dto validated payload (classification refs ignored)
   * @throws ValidationException on a cross-field invariant violation
   * @throws LabTestNameConflictException / LabTestCodeConflictException / LabTestParamCodeConflictException
   */
  async createTemplate(
    actorId: string | null,
    dto: CreateLabTestDto,
  ): Promise<LabTestWithChildren> {
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

    const { samples, resultParams, ...scalars } = dto;
    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(async (tx) => {
        const labTest = await tx.labTest.create({
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
        await this.createSamples(tx, null, null, labTest.id, samples);
        await this.createParams(tx, null, null, labTest.id, resultParams);
        return labTest.id;
      });
    } catch (e) {
      this.rethrowConflict(e, dto.testName, dto.testCode);
      throw e;
    }
    return this.findTemplateById(createdId);
  }

  /**
   * List SITE_ADMIN template lab tests for the configurable listing screen.
   * Supports `search` (testName/testCode), `status` → `isActive`, and the same
   * `view` projection as the tenant `listForView` (defaults to DEFAULT). The view
   * projection runs with a NULL tenant — templates have no classification, so
   * those denormalised name columns come back null; child-centric views
   * (SAMPLE/RESULTS/REFERENCE_*) read the template's NULL-tenant children.
   * Classification/`sampleType` filters don't apply to templates and are ignored.
   * @param query view + search + status + pagination
   */
  async findAllTemplates(
    query: ListLabTestsDto = {},
  ): Promise<PaginatedResult<LabTestListRow>> {
    const view = query.view ?? LabTestListView.DEFAULT;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.LabTestWhereInput = {
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
    const [tests, total] = await Promise.all([
      this.prisma.labTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.labTest.count({ where }),
    ]);
    const data = await this.projectListRows(view, null, tests);
    return { data, total, page, limit };
  }

  /**
   * Fetch one SITE_ADMIN template lab test composed with its children.
   * @param labTestId template id
   * @throws LabTestNotFoundException if missing/soft-deleted/not a template
   */
  async findTemplateById(labTestId: string): Promise<LabTestWithChildren> {
    const labTest = await this.findCoreTemplateById(labTestId);
    return this.composeWithChildren(labTest);
  }

  /**
   * Update a SITE_ADMIN template lab test (same child-replacement semantics as
   * `update`). Classification refs stay NULL. Runs in a plain transaction.
   * @param labTestId template id
   * @param dto partial update (classification refs ignored)
   * @throws LabTestNotFoundException / ValidationException / conflict exceptions
   */
  async updateTemplate(
    labTestId: string,
    dto: UpdateLabTestDto,
  ): Promise<LabTestWithChildren> {
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

    const { samples, resultParams, ...scalars } = dto;
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.labTest.update({
          where: { id: labTestId },
          data: { ...scalars, ...TEMPLATE_NULLED_REFS },
        });
        if (samples !== undefined) {
          await tx.labTestSample.updateMany({
            where: { labTestId, tenantId: null, deletedAt: null },
            data: { deletedAt: now },
          });
          await this.createSamples(tx, null, null, labTestId, samples);
        }
        if (resultParams !== undefined) {
          await tx.labTestReferenceRange.updateMany({
            where: { labTestId, tenantId: null, deletedAt: null },
            data: { deletedAt: now },
          });
          await tx.labTestReferenceValue.updateMany({
            where: { labTestId, tenantId: null, deletedAt: null },
            data: { deletedAt: now },
          });
          await tx.labTestResultParam.updateMany({
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
   * Soft-delete a SITE_ADMIN template lab test and cascade soft-delete its
   * children, in one transaction.
   * @param labTestId template id
   * @throws LabTestNotFoundException if missing/soft-deleted/not a template
   */
  async removeTemplate(labTestId: string): Promise<LabTest> {
    await this.findCoreTemplateById(labTestId);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const where = { labTestId, tenantId: null, deletedAt: null };
      await tx.labTestReferenceRange.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.labTestReferenceValue.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.labTestResultParam.updateMany({
        where,
        data: { deletedAt: now },
      });
      await tx.labTestSample.updateMany({ where, data: { deletedAt: now } });
      return tx.labTest.update({
        where: { id: labTestId },
        data: { deletedAt: now },
      });
    });
  }

  /**
   * Clone a SITE_ADMIN template lab test into a tenant's catalogue (business-user
   * flow). `tenantId` comes from the caller's JWT; `branchId` from the target
   * master data; only `masterDataId` is client-supplied (validated to belong to
   * the tenant). The new test is `source = TENANT` with fresh ids and a fresh
   * `versionHistory` v1. Fully transactional.
   * @param templateId the SITE_ADMIN template to clone
   * @param tenantId caller's tenant
   * @param masterDataId target master data (validated against the tenant)
   * @returns the newly-created tenant lab test with children
   * @throws LabTestNotFoundException if `templateId` is not a live template
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws LabTestNameConflictException / LabTestCodeConflictException on a clash
   */
  async cloneToTenant(
    templateId: string,
    tenantId: string,
    masterDataId: string,
  ): Promise<LabTestWithChildren> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );
    const template = await this.findCoreTemplateById(templateId);
    let newId: string;
    try {
      newId = await this.prisma.withTenant(tenantId, async (tx) => {
        const created = await this.clonePersistTest(tx, template, {
          tenantId,
          branchId: masterData.branchId,
          masterDataId,
          source: DataSource.TENANT,
          actorId: null,
        });
        return created.id;
      });
    } catch (e) {
      this.rethrowConflict(e, template.testName, template.testCode);
      throw e;
    }
    return this.findById(masterDataId, newId, tenantId);
  }

  /**
   * Clone a SITE_ADMIN template lab test into a tenant within an EXISTING
   * transaction — used by `LabPanelService` when adopting a template panel, so
   * the panel and its cloned tests share one all-or-nothing transaction. Returns
   * the new TENANT test row.
   * @param tx the caller's transaction client (already in `withTenant`)
   * @param templateId the SITE_ADMIN template test to clone
   * @param target tenant/branch/master data for the new test
   * @throws LabTestNotFoundException if `templateId` is not a live template
   */
  async cloneTemplateTestWithinTx(
    tx: Prisma.TransactionClient,
    templateId: string,
    target: { tenantId: string; branchId: string; masterDataId: string },
  ): Promise<LabTest> {
    const template = await tx.labTest.findFirst({
      where: { id: templateId, source: DataSource.SITE_ADMIN, deletedAt: null },
    });
    if (!template) {
      throw new LabTestNotFoundException(templateId);
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
   * Fetch one active SITE_ADMIN template lab test (core row only).
   * @throws LabTestNotFoundException if missing/soft-deleted/not a template
   */
  private async findCoreTemplateById(labTestId: string): Promise<LabTest> {
    const labTest = await this.prisma.labTest.findFirst({
      where: { id: labTestId, source: DataSource.SITE_ADMIN, deletedAt: null },
    });
    if (!labTest) {
      throw new LabTestNotFoundException(labTestId);
    }
    return labTest;
  }

  /**
   * Bulk-edit lab tests: apply each item's scalar changes to its own `labTestId`
   * (all scoped to the caller's tenant + the path's master data). All-or-nothing —
   * every item is validated up front (against the test's existing values) and the
   * updates run in one transaction, so if any item is invalid or its `labTestId`
   * can't be resolved nothing changes. Children and `testName`/`testCode` are not
   * bulk-editable.
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param dto the array of per-test edits
   * @returns the number of lab tests updated
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws ValidationException on duplicate ids, an empty item, or a broken invariant
   * @throws LabTestNotFoundException if a `labTestId` doesn't resolve to an active test
   */
  async bulkEdit(
    masterDataId: string,
    tenantId: string,
    dto: BulkEditLabTestsDto,
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
          `No changes provided for lab test ${labTestId}`,
        );
      }
      return { labTestId, changes, data };
    });

    const tests = await this.prisma.labTest.findMany({
      where: { id: { in: ids }, masterDataId, tenantId, deletedAt: null },
    });
    const testById = new Map(tests.map((t) => [t.id, t]));
    const missing = ids.find((id) => !testById.has(id));
    if (missing) {
      throw new LabTestNotFoundException(missing);
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
        await tx.labTest.update({ where: { id: labTestId }, data });
      }
    });
    return { updated: edits.length };
  }

  /**
   * Bulk-import lab tests (create-only) from the frontend's parsed Excel rows.
   * Every row is validated first — structural (class-validator), cross-field
   * (price/mandatory/repeat invariants), and duplicate `testName`/`testCode`
   * (against the batch itself and against existing active tests in the master
   * data). If ANY row fails, nothing is saved and a single
   * `LabTestImportValidationException` carries the row-numbered messages. On
   * success every row is created in one transaction (seeded `versionHistory` v1).
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param actorId person id recorded as `modifiedBy` on each seeded v1
   * @param dto the rows to import
   * @returns the number of lab tests created
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws LabTestImportValidationException if any row fails validation
   */
  async importAll(
    masterDataId: string,
    tenantId: string,
    actorId: string,
    dto: ImportLabTestsDto,
  ): Promise<ImportResult> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );

    // Errors keyed by row label so messages stay ordered and de-duplicated.
    const errors: { row: number; message: string }[] = [];
    const rows: { row: number; dto: ImportLabTestRowDto }[] = [];

    for (let i = 0; i < dto.rows.length; i++) {
      const raw = dto.rows[i];
      const row = plainToInstance(ImportLabTestRowDto, raw);
      const label = row.rowNumber ?? i + 1;

      const failures = await validate(row, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      if (failures.length) {
        for (const f of failures) {
          for (const msg of Object.values(f.constraints ?? {})) {
            errors.push({ row: label, message: msg });
          }
        }
        continue; // skip semantic checks for a structurally invalid row
      }

      try {
        this.assertCoreInvariants({
          priceMsrp: row.priceMsrp ?? 0,
          priceMaximum: row.priceMaximum ?? 0,
          priceMinimum: row.priceMinimum ?? 0,
          isMandatoryTest: row.isMandatoryTest ?? false,
          mandatoryDeptId: row.mandatoryDeptId ?? null,
          isRepeatIntervalRestriction: row.isRepeatIntervalRestriction ?? false,
          repeatIntervalValue: row.repeatIntervalValue ?? null,
          repeatIntervalUnit: row.repeatIntervalUnit ?? null,
        });
        await this.assertCatalogueRefs(tenantId, {
          departmentId: row.departmentId,
          categoryId: row.categoryId,
          subCategoryId: row.subCategoryId,
          mandatoryDeptId: row.mandatoryDeptId,
          mandatoryCatId: row.mandatoryCatId,
          mandatorySubcatId: row.mandatorySubcatId,
        });
      } catch (e) {
        if (e instanceof ValidationException) {
          errors.push({ row: label, message: e.message });
          continue;
        }
        throw e;
      }
      rows.push({ row: label, dto: row });
    }

    // Duplicate detection (within the batch + against existing active tests).
    this.collectDuplicateErrors(
      rows,
      await this.existingKeys(masterDataId, tenantId, rows),
      errors,
    );

    if (errors.length) {
      const messages = errors
        .sort((a, b) => a.row - b.row)
        .map((e) => `Row ${e.row}: ${e.message}`);
      throw new LabTestImportValidationException(messages);
    }

    await this.prisma.withTenant(tenantId, (tx) =>
      tx.labTest.createMany({
        data: rows.map(({ dto: r }) => {
          const scalars = { ...r };
          delete scalars.rowNumber; // not a column; only used for error labels
          return {
            ...scalars,
            tenantId,
            branchId: masterData.branchId,
            masterDataId,
            versionHistory: [
              this.seedVersion(actorId),
            ] as unknown as Prisma.InputJsonValue,
          };
        }),
      }),
    );
    return { created: rows.length };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /** Strip undefined keys from one bulk-edit item's changes, yielding a Prisma update. */
  private pickDefined(
    changes: Omit<BulkEditLabTestItemDto, 'labTestId'>,
  ): Prisma.LabTestUpdateInput {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * The `testName`/`testCode` values already taken by active tests in this master
   * data among the import batch's values. One batched query (exact match, mirroring
   * the case-sensitive partial unique indexes in prisma/rls.sql).
   */
  private async existingKeys(
    masterDataId: string,
    tenantId: string,
    rows: { dto: ImportLabTestRowDto }[],
  ): Promise<{ names: Set<string>; codes: Set<string> }> {
    const names = [...new Set(rows.map((r) => r.dto.testName))];
    const codes = [...new Set(rows.map((r) => r.dto.testCode))];
    const found = await this.prisma.labTest.findMany({
      where: {
        masterDataId,
        tenantId,
        deletedAt: null,
        OR: [{ testName: { in: names } }, { testCode: { in: codes } }],
      },
      select: { testName: true, testCode: true },
    });
    return {
      names: new Set(found.map((t) => t.testName)),
      codes: new Set(found.map((t) => t.testCode)),
    };
  }

  /**
   * Append duplicate-`testName`/`testCode` errors for the import: a value already
   * used by an existing active test, or repeated earlier in the same batch, is
   * flagged on the row that (re)introduces it.
   */
  private collectDuplicateErrors(
    rows: { row: number; dto: ImportLabTestRowDto }[],
    existing: { names: Set<string>; codes: Set<string> },
    errors: { row: number; message: string }[],
  ): void {
    const seenNames = new Set<string>();
    const seenCodes = new Set<string>();
    for (const { row, dto } of rows) {
      if (existing.codes.has(dto.testCode)) {
        errors.push({
          row,
          message: `testCode '${dto.testCode}' already exists in this master data`,
        });
      } else if (seenCodes.has(dto.testCode)) {
        errors.push({
          row,
          message: `testCode '${dto.testCode}' is duplicated in the import`,
        });
      } else {
        seenCodes.add(dto.testCode);
      }

      if (existing.names.has(dto.testName)) {
        errors.push({
          row,
          message: `testName '${dto.testName}' already exists in this master data`,
        });
      } else if (seenNames.has(dto.testName)) {
        errors.push({
          row,
          message: `testName '${dto.testName}' is duplicated in the import`,
        });
      } else {
        seenNames.add(dto.testName);
      }
    }
  }

  /**
   * Fetch one active lab test (core row only) scoped to its tenant + master data.
   * @throws LabTestNotFoundException if missing/soft-deleted/other master data
   */
  private async findCoreById(
    labTestId: string,
    masterDataId: string,
    tenantId: string,
  ): Promise<LabTest> {
    const labTest = await this.prisma.labTest.findFirst({
      where: { id: labTestId, masterDataId, tenantId, deletedAt: null },
    });
    if (!labTest) {
      throw new LabTestNotFoundException(labTestId);
    }
    return labTest;
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
    samples: CreateLabTestDto['samples'],
  ): Promise<void> {
    if (!samples?.length) {
      return;
    }
    await tx.labTestSample.createMany({
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
    params: LabTestResultParamDto[] | undefined,
  ): Promise<void> {
    for (const p of params ?? []) {
      // `reflexTests` is stored as a JSON snapshot of { id, name } objects,
      // exactly as sent (no FK extraction).
      const { referenceRanges, referenceValues, reflexTests, ...paramScalars } =
        p;
      const param = await tx.labTestResultParam.create({
        data: {
          ...paramScalars,
          reflexTests: (reflexTests ?? []) as unknown as Prisma.InputJsonValue,
          tenantId,
          branchId,
          labTestId,
        },
      });
      if (referenceRanges?.length) {
        await tx.labTestReferenceRange.createMany({
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
        await tx.labTestReferenceValue.createMany({
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

  /** A shallow copy of a row with the re-derived meta keys removed (for cloning). */
  private stripMeta(row: Record<string, unknown>): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...row };
    for (const key of META_KEYS) {
      delete copy[key];
    }
    return copy;
  }

  /** Build the seed v1 version entry for a freshly-created test. */
  private seedVersion(actorId: string | null): LabTestVersionEntry {
    return {
      version: 1,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: null,
      modifiedBy: actorId,
      approvedBy: null,
    };
  }

  /** Read a lab test's `versionHistory` Json into a typed, mutable array. */
  private readVersionHistory(value: Prisma.JsonValue): LabTestVersionEntry[] {
    return Array.isArray(value)
      ? (value as unknown as LabTestVersionEntry[])
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
    if (c.isMandatoryTest && !c.mandatoryDeptId) {
      throw new ValidationException(
        'mandatoryDeptId is required when isMandatoryTest is true',
      );
    }
    if (
      c.isRepeatIntervalRestriction &&
      (c.repeatIntervalValue == null || c.repeatIntervalUnit == null)
    ) {
      throw new ValidationException(
        'repeatIntervalValue and repeatIntervalUnit are required when isRepeatIntervalRestriction is true',
      );
    }
  }

  /**
   * Check whether a catalogue row (department / category / sub-category) exists
   * as an active row of the given tenant.
   * @param tenantId tenant scope
   * @param model which catalogue table to look in
   * @param id the id to look up
   * @returns true if a live row of this tenant has that id
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
   * Validate that any provided classification / mandatory-test catalogue refs
   * point at an active row of the caller's tenant. These columns are real
   * foreign keys (CLAUDE.md §4.7), so an unknown id would otherwise surface as a
   * raw DB error instead of a clean 400.
   * @param tenantId tenant scope
   * @param refs the dept/cat/subcat ids from the payload (any may be
   *   undefined/null = not being set)
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
  private assertParam(p: LabTestResultParamDto): void {
    if (p.parameterType === ParameterType.CALCULATED && !p.calculationFormula) {
      throw new ValidationException(
        'calculationFormula is required when parameterType is CALCULATED',
        { parameterCode: p.parameterCode },
      );
    }
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

  /** Validate a numeric reference range's bounds. */
  private assertRange(r: LabTestReferenceRangeDto): void {
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
   * The violated index name arrives in `error.meta.target`.
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
      throw new LabTestParamCodeConflictException('');
    }
    if (target.includes('test_code')) {
      throw new LabTestCodeConflictException(testCode);
    }
    throw new LabTestNameConflictException(testName);
  }
}
