import { Injectable } from '@nestjs/common';
import {
  AbnormalFlag,
  AgeUnit,
  ContainerType,
  DataSource,
  DayOfWeek,
  LabTest,
  LabTestReferenceRange,
  LabTestReferenceValue,
  LabTestResultParam,
  LabTestSample,
  ParameterType,
  Prisma,
  ProcessMethod,
  ReferenceGender,
  RepeatIntervalUnit,
  ResultRounding,
  ResultType,
  SamplePriority,
  TatUnit,
} from '@prisma/client';
import * as ExcelJS from 'exceljs';
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
  ImportXlsxReferenceRangeRowDto,
  ImportXlsxReferenceValueRowDto,
  ImportXlsxResultParamRowDto,
  ImportXlsxSampleRowDto,
  ImportXlsxTestRowDto,
  BOOLEAN_FIELDS,
  DAY_LABEL_TO_ENUM,
  ENUM_LABEL_FIELDS,
  ENUM_VALUE_TO_LABEL,
  FIELD_TO_COLUMN_LABEL,
  INTEGER_FIELDS,
  NUMERIC_FIELDS,
  SEMICOLON_LIST_FIELDS,
  STATUS_LABEL_TO_ACTIVE,
  XLSX_COLUMNS,
  XLSX_SHEET_NAME,
} from './dto/import-lab-tests-xlsx.dto';
import {
  ImportableTemplateRow,
  ImportXlsxResult,
  ImportXlsxSkippedTest,
  LabTestExportPayload,
  LabTestExportTest,
  LabTestImportResult,
  LabTestListRow,
  LabTestListView,
  LabTestRefRangeRow,
  LabTestRefValueRow,
  LabTestResultsParamRow,
  LabTestSampleRow,
  LabTestSyncResult,
  LabTestVersionEntry,
  LabTestWithChildren,
  ReflexTestRef,
} from './entities/lab-test.entity';
import { ImportLabTestTemplatesDto } from './dto/import-lab-test-templates.dto';
import { SyncLabTestTemplatesDto } from './dto/sync-lab-test-templates.dto';
import {
  LabTestCodeConflictException,
  LabTestImportValidationException,
  LabTestNameConflictException,
  LabTestNotFoundException,
  LabTestParamCodeConflictException,
  LabTestSampleRequiredException,
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

/**
 * Canonical `XLSX_COLUMNS` position (0-based) for every field the flat
 * single-sheet import parser reads, resolved once per import by
 * `LabTestService.buildColumnIndex()`. A concrete field list (not
 * `Record<string, number>`) so indexed access stays a plain, always-defined
 * `number` under `noUncheckedIndexedAccess` — see the doc comment on
 * `buildColumnIndex` for why several of these disambiguate a repeated
 * header label via block position (Result Parameter / Reference Range /
 * Reference Value).
 */
interface ColumnIndex {
  testName: number;
  sampleName: number;
  sampleType: number;
  containerType: number;
  sampleSize: number;
  collectionMethod: number;
  numberOfSamples: number;
  stability: number;
  transportTemperature: number;
  preservative: number;
  sampleHandlingInstructions: number;
  fastingRequired: number;
  lightProtection: number;
  setAsDefault: number;
  groupName: number;
  groupLayout: number;
  groupSettings: number;
  paramName: number;
  parameterCode: number;
  paramMethod: number;
  reportingUnit: number;
  resultType: number;
  parameterType: number;
  nabl: number;
  cap: number;
  resultRoundingType: number;
  iconSettings: number;
  reflexTest: number;
  calculationFormula: number;
  allowableUnits: number;
  paramNotes: number;
  rangeMethod: number;
  rangeGender: number;
  rangeAgeFrom: number;
  rangeAgeFromUnit: number;
  rangeAgeTo: number;
  rangeAgeToUnit: number;
  lowerLimit: number;
  upperLimit: number;
  criticalMin: number;
  criticalMax: number;
  displayOfRange: number;
  rangeFlag: number;
  valueMethod: number;
  valueGender: number;
  valueAgeFrom: number;
  valueAgeFromUnit: number;
  valueAgeTo: number;
  valueAgeToUnit: number;
  displayOfValue: number;
  valueFlag: number;
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
    // A lab test must carry at least one sample (drives OrderSample generation).
    if (!dto.samples?.length) throw new LabTestSampleRequiredException();
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

  /**
   * Batch-resolve `Person.id` → display name (`firstName [middleName] lastName`),
   * for showing a human name instead of a raw id — e.g. a lab test's
   * `versionHistory.modifiedBy`/`approvedBy` on export. `Person` is a
   * platform-level model (no tenant scoping).
   */
  private async personNamesById(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!ids.length) {
      return map;
    }
    const people = await this.prisma.person.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, middleName: true, lastName: true },
    });
    for (const p of people) {
      const name = [p.firstName, p.middleName, p.lastName]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(' ');
      if (name) map.set(p.id, name);
    }
    return map;
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
    // Samples may be omitted (left unchanged), but never cleared to empty — a
    // lab test must always keep at least one sample.
    if (dto.samples !== undefined && dto.samples.length < 1) {
      throw new LabTestSampleRequiredException();
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
    return this.prisma.withTenant(tenantId, (tx) =>
      this.cascadeDeleteTest(tx, labTestId, tenantId, new Date()),
    );
  }

  /**
   * Soft-delete cascade body shared by `remove()` (user-initiated) and
   * `syncTestsIntoBranch` (orphan cleanup for a tenant-deleted source test).
   * Assumes the caller has already validated the test and owns the tx.
   */
  private async cascadeDeleteTest(
    tx: Prisma.TransactionClient,
    labTestId: string,
    tenantId: string,
    now: Date,
  ): Promise<LabTest> {
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
   * Sync (update-or-create-or-delete) all active lab tests from a Tenant Master
   * Data into a Branch Master Data, keyed on `sourceMasterLabTestId` (falling
   * back to `testCode` to adopt a legacy branch row and avoid a unique
   * collision). A matched branch test is FULLY overwritten from the tenant
   * test (scalars + hard-deleted/rebuilt children, version bumped); an
   * unmatched one is cloned. Runs inside the caller's transaction. Returns a
   * `tenantTestId → branchTestId` map (so panels can remap membership) plus
   * counts. A branch test whose tenant source has been soft-deleted (i.e. no
   * longer among the active `sourceTests`) is itself soft-deleted, cascading
   * to its children — UNLESS its `sourceMasterLabTestId` is NULL, meaning it
   * was hand-created/never synced, which is always left untouched.
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
    const sourceTests = await tx.labTest.findMany({
      where: { masterDataId: tenantMasterDataId, tenantId, deletedAt: null },
    });
    const branchTests = await tx.labTest.findMany({
      where: { masterDataId: branchMasterDataId, tenantId, deletedAt: null },
    });
    const bySource = new Map<string, LabTest>();
    const byCode = new Map<string, LabTest>();
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
        // Full overwrite: tenant test scalars win; identity/scope preserved.
        await tx.labTest.update({
          where: { id: target.id },
          data: {
            ...this.stripMeta(src),
            sourceMasterLabTestId: src.id,
            versionHistory: history as unknown as Prisma.InputJsonValue,
          },
        });
        // Rebuild children: hard-delete then recopy from the tenant test.
        await tx.labTestReferenceRange.deleteMany({
          where: { labTestId: target.id, tenantId },
        });
        await tx.labTestReferenceValue.deleteMany({
          where: { labTestId: target.id, tenantId },
        });
        await tx.labTestResultParam.deleteMany({
          where: { labTestId: target.id, tenantId },
        });
        await tx.labTestSample.deleteMany({
          where: { labTestId: target.id, tenantId },
        });
        await this.copyTestChildren(tx, src.id, src.tenantId, {
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
        t.sourceMasterLabTestId !== null &&
        !sourceIds.has(t.sourceMasterLabTestId),
    );
    const now = new Date();
    let deleted = 0;
    for (const orphan of orphans) {
      await this.cascadeDeleteTest(tx, orphan.id, tenantId, now);
      deleted += 1;
    }

    return { testIdMap, created, updated, deleted };
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
      /** Set on a Tenant→Branch MD sync to link the branch copy to its source. */
      sourceMasterLabTestId?: string | null;
    },
  ): Promise<LabTest> {
    const { tenantId, branchId, masterDataId, source, actorId } = target;
    const srcTenantId = src.tenantId;
    // Track provenance only when adopting a SITE_ADMIN template into a tenant;
    // a tenant→tenant clone (e.g. between master datas) keeps `clonedFromId` NULL.
    const clonedFromId = src.source === DataSource.SITE_ADMIN ? src.id : null;
    const newTest = await tx.labTest.create({
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
      } as Prisma.LabTestUncheckedCreateInput,
    });

    await this.copyTestChildren(tx, src.id, srcTenantId, {
      tenantId,
      branchId,
      labTestId: newTest.id,
    });
    return newTest;
  }

  /**
   * Copy a lab test's children (samples, result params, and each param's
   * reference ranges/values) from `srcTestId` onto `target.labTestId`, re-scoping
   * them to `target.tenantId`/`branchId` and stripping meta keys. Shared by the
   * clone engine and by `syncTemplates` (which first hard-deletes the existing
   * children). Assumes the caller runs inside the correct tenant transaction.
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
    const samples = await tx.labTestSample.findMany({
      where: { labTestId: srcTestId, tenantId: srcTenantId, deletedAt: null },
    });
    if (samples.length) {
      await tx.labTestSample.createMany({
        data: samples.map((s) => ({
          ...this.stripMeta(s),
          tenantId,
          branchId,
          labTestId,
        })),
      });
    }

    const params = await tx.labTestResultParam.findMany({
      where: { labTestId: srcTestId, tenantId: srcTenantId, deletedAt: null },
    });
    for (const param of params) {
      const newParam = await tx.labTestResultParam.create({
        data: {
          ...this.stripMeta(param),
          tenantId,
          branchId,
          labTestId,
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
            labTestId,
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
            labTestId,
            paramId: newParam.id,
          })) as Prisma.LabTestReferenceValueCreateManyInput[],
        });
      }
    }
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
    tenantId?: string,
  ): Promise<PaginatedResult<ImportableTemplateRow>> {
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

    // Import annotation: which templates the tenant has already imported into the
    // target master data (tracked by `clonedFromId`). Requires both a tenant and
    // a `masterDataId`; validates ownership so a foreign id can't leak scope.
    let importedTemplateIds = new Set<string>();
    if (tenantId && query.masterDataId) {
      await this.masterDataService.findById(query.masterDataId, tenantId);
      const imported = await this.prisma.labTest.findMany({
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
      this.prisma.labTest.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.labTest.count({ where }),
    ]);
    const rows = await this.projectListRows(view, null, tests);
    const data: ImportableTemplateRow[] = rows.map((row) => ({
      ...row,
      isImported: importedTemplateIds.has(row.id),
    }));
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
   * Bulk-import SITE_ADMIN template lab tests into a tenant's master data. Each
   * template is imported in its own transaction so one failure never aborts the
   * batch: templates already imported into this master data (tracked by
   * `clonedFromId`) are skipped, missing/deleted templates and name/code
   * conflicts are reported as failures.
   * @param tenantId tenant scope (from the JWT)
   * @param actorId person recorded on the seed version (or null)
   * @param dto target master data + SITE_ADMIN template ids
   * @returns an `{ imported, skipped, failed }` summary
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async importTemplates(
    tenantId: string,
    actorId: string | null,
    dto: ImportLabTestTemplatesDto,
  ): Promise<LabTestImportResult> {
    const masterData = await this.masterDataService.findById(
      dto.masterDataId,
      tenantId,
    );
    const templates = await this.prisma.labTest.findMany({
      where: {
        id: { in: dto.templateIds },
        source: DataSource.SITE_ADMIN,
        deletedAt: null,
      },
    });
    const templateById = new Map(templates.map((t) => [t.id, t]));
    const already = await this.prisma.labTest.findMany({
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

    const result: LabTestImportResult = {
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
          const created = await this.clonePersistTest(tx, template, {
            tenantId,
            branchId: masterData.branchId,
            masterDataId: dto.masterDataId,
            source: DataSource.TENANT,
            actorId,
          });
          return created.id;
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
   * Re-pull previously-imported lab tests from their SITE_ADMIN templates. Full
   * overwrite: the tenant copy's scalars are replaced from the template and its
   * children (samples, params, reference ranges/values) are hard-deleted and
   * recreated (avoids unique-code `P2002` from soft-deleted rows). Identity
   * (`id`/`tenantId`/`branchId`/`masterDataId`/`source`/`clonedFromId`) is
   * preserved, `versionHistory` is bumped, and `templateSyncedAt` is stamped.
   * Hand-created tests (`clonedFromId = null`) are never touched. Each test is
   * synced in its own transaction so one failure never aborts the batch.
   * @param tenantId tenant scope (from the JWT)
   * @param actorId person recorded on the bumped version (or null)
   * @param dto master data + optional subset of tenant lab-test ids
   * @returns a `{ synced, skipped, failed }` summary
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  async syncTemplates(
    tenantId: string,
    actorId: string | null,
    dto: SyncLabTestTemplatesDto,
  ): Promise<LabTestSyncResult> {
    await this.masterDataService.findById(dto.masterDataId, tenantId);
    const where: Prisma.LabTestWhereInput = {
      tenantId,
      masterDataId: dto.masterDataId,
      clonedFromId: { not: null },
      deletedAt: null,
    };
    if (dto.labTestIds?.length) {
      where.id = { in: dto.labTestIds };
    }
    const tests = await this.prisma.labTest.findMany({ where });

    const result: LabTestSyncResult = { synced: [], skipped: [], failed: [] };
    for (const test of tests) {
      const templateId = test.clonedFromId;
      if (!templateId) {
        continue;
      }
      const template = await this.prisma.labTest.findFirst({
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
          // Full overwrite of scalars from the template; identity + provenance
          // are preserved via `stripMeta` (it drops id/tenant/branch/masterData/
          // source/clonedFromId/templateSyncedAt/versionHistory).
          await tx.labTest.update({
            where: { id: test.id },
            data: {
              ...this.stripMeta(template),
              templateSyncedAt: new Date(),
              versionHistory: history as unknown as Prisma.InputJsonValue,
            },
          });
          // Rebuild children: hard-delete then recreate from the template.
          await tx.labTestReferenceRange.deleteMany({
            where: { labTestId: test.id, tenantId },
          });
          await tx.labTestReferenceValue.deleteMany({
            where: { labTestId: test.id, tenantId },
          });
          await tx.labTestResultParam.deleteMany({
            where: { labTestId: test.id, tenantId },
          });
          await tx.labTestSample.deleteMany({
            where: { labTestId: test.id, tenantId },
          });
          await this.copyTestChildren(tx, template.id, template.tenantId, {
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
    target: { tenantId: string; branchId: string | null; masterDataId: string },
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

  /**
   * Full, unpaginated snapshot of every active lab test in a master data plus
   * all of its children (samples, result parameters, reference ranges/values),
   * for the "Export" Excel workbook. Classification names are resolved so the
   * exported sheet is human-editable (round-tripped back to ids on import).
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   */
  /**
   * Full unpaginated snapshot of a master data's active lab tests, fully
   * composed with their samples and result parameters (each carrying nested
   * reference ranges/values), for the frontend to build the single flat
   * "Lab Tests" export sheet (see `labTestExcel.ts`'s row-expansion
   * algorithm). Classification ids are resolved to display names; no
   * per-grid-tab "views" projection any more — this new format is one sheet,
   * not twelve.
   */
  async exportAll(
    masterDataId: string,
    tenantId: string,
  ): Promise<LabTestExportPayload> {
    await this.masterDataService.findById(masterDataId, tenantId);
    const tests = await this.prisma.labTest.findMany({
      where: { masterDataId, tenantId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const ids = tests.map((t) => t.id);

    const [deptNames, catNames, subcatNames] = await Promise.all([
      this.resolveNames('department', tenantId, [
        ...tests.map((t) => t.departmentId),
        ...tests.map((t) => t.mandatoryDeptId),
      ]),
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

    const [samplesByTest, paramsByTest, rangesByTest, valuesByTest] =
      await Promise.all([
        this.fetchSamples(tenantId, ids),
        this.fetchParams(tenantId, ids),
        this.fetchRanges(tenantId, ids),
        this.fetchValues(tenantId, ids),
      ]);

    const personIds = new Set<string>();
    for (const t of tests) {
      for (const v of this.readVersionHistory(t.versionHistory)) {
        if (v.modifiedBy) personIds.add(v.modifiedBy);
        if (v.approvedBy) personIds.add(v.approvedBy);
      }
    }
    const personNames = await this.personNamesById([...personIds]);

    const exportTests: LabTestExportTest[] = tests.map((t) => {
      const params = paramsByTest.get(t.id) ?? [];
      return {
        ...t,
        versionHistory: this.readVersionHistory(t.versionHistory).map((v) => ({
          ...v,
          modifiedBy: v.modifiedBy
            ? (personNames.get(v.modifiedBy) ?? v.modifiedBy)
            : null,
          approvedBy: v.approvedBy
            ? (personNames.get(v.approvedBy) ?? v.approvedBy)
            : null,
        })),
        departmentName: this.nameOf(deptNames, t.departmentId),
        mandatoryDeptName: this.nameOf(deptNames, t.mandatoryDeptId),
        categoryName: this.nameOf(catNames, t.categoryId),
        subCategoryName: this.nameOf(subcatNames, t.subCategoryId),
        samples: samplesByTest.get(t.id) ?? [],
        resultParams: params.map((p) => {
          const { reflexTests, ...scalars } = p;
          const refs = (reflexTests ?? []) as unknown as ReflexTestRef[];
          return {
            ...scalars,
            reflexTestNames: refs.map((r) => r.name).join('; '),
            referenceRanges: (rangesByTest.get(t.id) ?? []).filter(
              (r) => r.paramId === p.id,
            ),
            referenceValues: (valuesByTest.get(t.id) ?? []).filter(
              (v) => v.paramId === p.id,
            ),
          };
        }),
      };
    });

    return { tests: exportTests };
  }

  /**
   * Import (upsert) lab tests from an uploaded `.xlsx` workbook: ONE flat
   * worksheet named `Lab Tests` (`XLSX_SHEET_NAME`), 120 columns (117 match
   * the reference file exactly plus 3 added — see `ImportXlsxTestRowDto`'s
   * doc comment; `XLSX_COLUMNS`, positional order — several header labels
   * repeat, e.g. "Parameter Name"/"Method"/"GENDER" each appear in the
   * Result Parameter block AND the Reference Range block AND the Reference
   * Value block, so columns are read by POSITION, not by unique header
   * text). A test spans one or more physical rows — Test-level scalar
   * columns are populated only on the test's FIRST row (a row with a blank
   * `Test Name` continues the nearest test above it, per the row-span
   * grouping below); Samples align positionally within the row-span
   * (`buildSamplesForSpan`); Result Parameters and their nested Reference
   * Ranges/Values form contiguous blocks (`buildParamsForSpan`).
   *
   * PARTIAL IMPORT: every assembled test is validated independently. A test
   * with an error is skipped (not saved) and reported in the returned
   * `skipped` array with every reason for that specific test — but every
   * OTHER valid test in the same file is still created/updated in one
   * transaction. This is deliberately NOT all-or-nothing: a large edited
   * sheet where only one test has a typo should not block updating the
   * rest. The one exception is a FILE-level structural failure (unreadable
   * file, missing sheet, missing a required column, no data rows at all) —
   * those have no single test to blame and still reject the whole upload,
   * since there's no per-row context to partially trust.
   *
   * A test matches an existing active test by `testCode` (case-insensitive)
   * — no match creates a new test. Whether matched or newly created, EVERY
   * written test's samples are fully replaced (delete-and-recreate); each
   * Result Parameter matches an existing one by `parameterCode` to preserve
   * its id (see `upsertParamsByCode`), and its Reference Ranges/Values are
   * fully replaced. Version Control columns are exported for round-trip
   * fidelity but IGNORED on import (version history is an audit trail
   * managed elsewhere, never bulk-edited via Excel).
   * @param masterDataId parent master data id
   * @param tenantId tenant scope
   * @param actorId person id recorded as `modifiedBy` on newly-created tests
   * @param buffer the uploaded `.xlsx` file bytes
   * @returns `{ created, updated, skipped }` — `skipped` is empty on a fully clean import
   * @throws MasterDataNotFoundException if the master data is missing/other tenant
   * @throws LabTestImportValidationException only for a file-level structural failure
   */
  async importXlsx(
    masterDataId: string,
    tenantId: string,
    actorId: string,
    buffer: Buffer,
  ): Promise<ImportXlsxResult> {
    const masterData = await this.masterDataService.findById(
      masterDataId,
      tenantId,
    );

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new LabTestImportValidationException([
        'The uploaded file could not be read — make sure it is a valid .xlsx workbook',
      ]);
    }

    const sheet = workbook.getWorksheet(XLSX_SHEET_NAME);
    if (!sheet) {
      throw new LabTestImportValidationException([
        `Missing sheet: ${XLSX_SHEET_NAME}`,
      ]);
    }

    const errors: string[] = [];

    // ── 1. Locate the header row. The reference file's row 1 is entirely
    //        blank and row 2 carries the headers — so the header row is
    //        found by CONTENT (the first row containing "Test Name"), not
    //        assumed to be row 1. Resolve each of the 117 canonical columns
    //        (`XLSX_COLUMNS`, positional) to a worksheet column NUMBER on
    //        that row. Several header labels repeat (e.g. "Parameter Name"
    //        appears at canonical positions 68/84/98 — Result Parameter /
    //        Reference Range / Reference Value blocks); the Nth occurrence
    //        of a label in `XLSX_COLUMNS` is matched to the Nth occurrence
    //        of that same label in the worksheet's header row, so a
    //        straight header-text→column Map (which can only hold one
    //        column per text) is NOT used here. ──────────────────────────
    const maxScanRow = Math.min(sheet.lastRow?.number ?? 1, 10);
    let headerRowNum = -1;
    for (let r = 1; r <= maxScanRow; r++) {
      const row = sheet.getRow(r);
      let found = false;
      row.eachCell((cell) => {
        if (this.cellToString(cell.value).trim() === 'Test Name') found = true;
      });
      if (found) {
        headerRowNum = r;
        break;
      }
    }
    if (headerRowNum === -1) {
      throw new LabTestImportValidationException([
        `Could not find the header row (looking for a "Test Name" column in the first ${maxScanRow} rows)`,
      ]);
    }
    const headerRow = sheet.getRow(headerRowNum);
    const worksheetColsByLabel = new Map<string, number[]>();
    headerRow.eachCell((cell, colNumber) => {
      const text = this.cellToString(cell.value).trim();
      if (!text) return;
      const arr = worksheetColsByLabel.get(text);
      if (arr) arr.push(colNumber);
      else worksheetColsByLabel.set(text, [colNumber]);
    });
    const occurrenceIndex = new Map<string, number>();
    const colForCanonicalIndex: (number | undefined)[] = XLSX_COLUMNS.map(
      (label) => {
        const seen = occurrenceIndex.get(label) ?? 0;
        occurrenceIndex.set(label, seen + 1);
        return worksheetColsByLabel.get(label)?.[seen];
      },
    );
    const missingColumns = XLSX_COLUMNS.filter(
      (_, i) => colForCanonicalIndex[i] === undefined,
    );
    if (missingColumns.length) {
      throw new LabTestImportValidationException(
        [...new Set(missingColumns)].map((c) => `Missing column: ${c}`),
      );
    }

    const COL = this.buildColumnIndex();

    // ── 2. Extract every data row into a plain `string[]` positioned by
    //        CANONICAL column index (0-based, matching `XLSX_COLUMNS`). The
    //        exported file vertically merges a test's scalar columns
    //        (including Test Name) across its whole row-span, and a Result
    //        Parameter's own columns (including its Parameter Name) across
    //        just its own range/value sub-block, for readability (see
    //        `labTestExcel.ts`). ExcelJS's `getCell()` returns the SAME text
    //        for every cell in a merged range, so a continuation row's Test
    //        Name / Parameter Name would otherwise read as non-blank too —
    //        blank them back out here (BEFORE anything downstream reads
    //        `v[COL.testName]`/`v[COL.paramName]`) so a merge-continuation
    //        row is indistinguishable from a genuinely blank one, exactly
    //        matching what an unmerged file would produce. ─────────────────
    type RawRow = { rowNum: number; v: string[] };
    const rawRows: RawRow[] = [];
    const lastRow = sheet.lastRow?.number ?? headerRowNum;
    const mergeSensitiveCanonicalCols = [COL.testName, COL.paramName];
    for (let rowNum = headerRowNum + 1; rowNum <= lastRow; rowNum++) {
      const row = sheet.getRow(rowNum);
      if (row.cellCount === 0) continue;
      const v = colForCanonicalIndex.map((col) =>
        col ? this.cellToString(row.getCell(col).value) : '',
      );
      for (const canonicalIdx of mergeSensitiveCanonicalCols) {
        const col = colForCanonicalIndex[canonicalIdx];
        const cell = col ? row.getCell(col) : undefined;
        // `Cell.master.row` is mistyped as `string` in @types/exceljs (it's
        // actually a `number` at runtime, verified directly) — cast to compare.
        const isMergeContinuation = Boolean(
          cell?.isMerged && (cell.master.row as unknown as number) !== rowNum,
        );
        if (isMergeContinuation) v[canonicalIdx] = '';
      }
      if (v.every((x) => x === '')) continue;
      rawRows.push({ rowNum, v });
    }

    if (!rawRows.length) {
      throw new LabTestImportValidationException([
        'The uploaded file has no data rows',
      ]);
    }

    // ── 3. Group rows into per-test row-spans: a row with a non-blank
    //        "Test Name" starts a new test; every row until (not including)
    //        the next non-blank "Test Name" belongs to that same test. ──────
    type TestSpan = { rows: RawRow[]; rowLabel: string };
    const spans: TestSpan[] = [];
    for (const raw of rawRows) {
      const testName = raw.v[COL.testName];
      if (testName !== '' || spans.length === 0) {
        spans.push({ rows: [raw], rowLabel: `Row ${raw.rowNum}` });
      } else {
        // `spans.length > 0` here, so this is always the just-pushed span.
        const span = spans[spans.length - 1]!;
        span.rows.push(raw);
        const first = span.rows[0]!.rowNum;
        const last = raw.rowNum;
        span.rowLabel =
          first === last ? `Row ${first}` : `Rows ${first}-${last}`;
      }
    }
    for (const span of spans) {
      // Every span is constructed with at least one row (see the push above).
      if (span.rows[0]!.v[COL.testName] === '') {
        errors.push(
          `${span.rowLabel}: Test Name is required on a test's first row`,
        );
      }
    }

    // ── 4. Assemble each span into one `ImportXlsxTestRowDto`. ─────────────
    const assembled: { dto: ImportXlsxTestRowDto; span: TestSpan }[] = [];
    for (const span of spans) {
      const firstRow = span.rows[0]!;
      if (firstRow.v[COL.testName] === '') continue; // already reported
      const dto = this.buildTestScalarsDto(firstRow, span.rowLabel);
      dto.samples = this.buildSamplesForSpan(span.rows, COL);
      dto.resultParams = this.buildParamsForSpan(span.rows, COL, errors);
      assembled.push({ dto, span });
    }

    // Per-test error tracking for PARTIAL import: every error message is
    // pushed as `${rowLabel}: ...` (rowLabel uniquely identifies one test's
    // row-span within this file — no two spans can share a range), so
    // grouping the flat `errors` list by that prefix tells us exactly which
    // tests to exclude from the write step while keeping every other valid
    // test. A structural failure (unreadable file, missing sheet/columns,
    // no data rows — all thrown directly, above) has no single test to
    // blame and still aborts the whole import; only per-test errors from
    // here on are skip-only.
    const rowLabelsWithErrors = new Set<string>();
    const recordError = (rowLabel: string, message: string): void => {
      errors.push(`${rowLabel}: ${message}`);
      rowLabelsWithErrors.add(rowLabel);
    };

    // ── 5. Resolve Department/Category/Sub Category/Mandatory Department
    //        name → id lookups. Mandatory Department reuses the same
    //        `department` lookup table as Department. ─────────────────────
    const deptNameToId = await this.namesToIds('department', tenantId, [
      ...assembled.map((a) => a.dto.departmentId),
      ...assembled.map((a) => a.dto.mandatoryDeptId),
    ]);
    const catNameToId = await this.namesToIds(
      'category',
      tenantId,
      assembled.map((a) => a.dto.categoryId),
    );
    const subcatNameToId = await this.namesToIds(
      'subCategory',
      tenantId,
      assembled.map((a) => a.dto.subCategoryId),
    );
    for (const { dto, span } of assembled) {
      const nameErrors: string[] = [];
      dto.departmentId = this.resolveOptionalNameField(
        dto.departmentId,
        'Department',
        deptNameToId,
        span.rowLabel,
        nameErrors,
      );
      dto.mandatoryDeptId = this.resolveOptionalNameField(
        dto.mandatoryDeptId,
        'Mandatory Department',
        deptNameToId,
        span.rowLabel,
        nameErrors,
      );
      dto.categoryId = this.resolveOptionalNameField(
        dto.categoryId,
        'Category',
        catNameToId,
        span.rowLabel,
        nameErrors,
      );
      dto.subCategoryId = this.resolveOptionalNameField(
        dto.subCategoryId,
        'Subcategory',
        subcatNameToId,
        span.rowLabel,
        nameErrors,
      );
      // `resolveOptionalNameField` already formats each message as
      // "<rowLabel>: <label> '<raw>' not found" — strip that back off so
      // `recordError` doesn't double the prefix.
      for (const m of nameErrors) {
        recordError(span.rowLabel, m.slice(span.rowLabel.length + 2));
      }
    }

    // ── 6. class-validator + cross-field invariants, per assembled test
    //        (skipping any span step 5 already failed — its resolved ids
    //        are unreliable, so validating it further would just pile on
    //        confusing secondary errors for a test we're excluding anyway). ─
    const validTests: {
      dto: ImportXlsxTestRowDto;
      matchedId: string | null;
    }[] = [];
    for (const { dto: raw, span } of assembled) {
      if (rowLabelsWithErrors.has(span.rowLabel)) continue;
      const instance = plainToInstance(ImportXlsxTestRowDto, raw);
      const failures = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      if (failures.length) {
        for (const f of failures) {
          for (const { rowLabel, message } of this.flattenValidationMessages(
            f,
            span.rowLabel,
          )) {
            recordError(rowLabel, message);
          }
        }
        continue;
      }
      try {
        this.assertCoreInvariants({
          priceMsrp: instance.priceMsrp ?? 0,
          priceMaximum: instance.priceMaximum ?? 0,
          priceMinimum: instance.priceMinimum ?? 0,
          isMandatoryTest: instance.isMandatoryTest ?? false,
          mandatoryDeptId: instance.mandatoryDeptId ?? null,
          isRepeatIntervalRestriction:
            instance.isRepeatIntervalRestriction ?? false,
          repeatIntervalValue: instance.repeatIntervalValue ?? null,
          repeatIntervalUnit: instance.repeatIntervalUnit ?? null,
        });
        await this.assertCatalogueRefs(tenantId, {
          departmentId: instance.departmentId,
          categoryId: instance.categoryId,
          subCategoryId: instance.subCategoryId,
          mandatoryDeptId: instance.mandatoryDeptId,
        });
        for (const p of instance.resultParams ?? []) {
          this.assertImportParam(p);
        }
      } catch (e) {
        if (e instanceof ValidationException) {
          recordError(span.rowLabel, this.validationMessage(e));
          continue;
        }
        throw e;
      }

      // A lab test must carry at least one sample (drives OrderSample
      // generation). An update-match row also wipes+recreates its samples
      // below, so an empty one would clear them — reject it here.
      if (!instance.samples?.length) {
        recordError(span.rowLabel, 'A lab test must have at least one sample');
        continue;
      }

      let matchedId: string | null = null;
      const byCode = await this.prisma.labTest.findFirst({
        where: {
          masterDataId,
          tenantId,
          deletedAt: null,
          testCode: { equals: instance.testCode, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (byCode) matchedId = byCode.id;

      validTests.push({ dto: instance, matchedId });
    }

    // ── 7. Duplicate testName/testCode checks (within batch + against
    //        existing, excluding a row's own matched id). Also duplicate
    //        Parameter Code within the same test. Runs only over tests that
    //        passed steps 5-6 — a duplicate here excludes just that test,
    //        same as any other per-test failure. ─────────────────────────
    const existing = await this.prisma.labTest.findMany({
      where: { masterDataId, tenantId, deletedAt: null },
      select: { id: true, testName: true, testCode: true },
    });
    const existingByName = new Map(
      existing.map((t) => [t.testName.toLowerCase(), t.id]),
    );
    const existingByCode = new Map(
      existing.map((t) => [t.testCode.toLowerCase(), t.id]),
    );
    const seenNames = new Map<string, string>();
    const seenCodes = new Map<string, string>();
    for (const { dto, matchedId } of validTests) {
      const rowLabel = dto.rowLabel ?? '';
      const nameKey = dto.testName.toLowerCase();
      const codeKey = dto.testCode.toLowerCase();
      const nameOwner = existingByName.get(nameKey);
      if (nameOwner && nameOwner !== matchedId) {
        recordError(
          rowLabel,
          `testName '${dto.testName}' already exists in this master data`,
        );
      } else if (
        seenNames.has(nameKey) &&
        seenNames.get(nameKey) !== rowLabel
      ) {
        recordError(
          rowLabel,
          `testName '${dto.testName}' is duplicated in the import`,
        );
        recordError(
          seenNames.get(nameKey)!,
          `testName '${dto.testName}' is duplicated in the import`,
        );
      } else {
        seenNames.set(nameKey, rowLabel);
      }
      const codeOwner = existingByCode.get(codeKey);
      if (codeOwner && codeOwner !== matchedId) {
        recordError(
          rowLabel,
          `testCode '${dto.testCode}' already exists in this master data`,
        );
      } else if (
        seenCodes.has(codeKey) &&
        seenCodes.get(codeKey) !== rowLabel
      ) {
        recordError(
          rowLabel,
          `testCode '${dto.testCode}' is duplicated in the import`,
        );
        recordError(
          seenCodes.get(codeKey)!,
          `testCode '${dto.testCode}' is duplicated in the import`,
        );
      } else {
        seenCodes.set(codeKey, rowLabel);
      }

      const seenParamCodes = new Set<string>();
      for (const p of dto.resultParams ?? []) {
        const pKey = p.parameterCode.toLowerCase();
        if (seenParamCodes.has(pKey)) {
          recordError(
            rowLabel,
            `Parameter Code '${p.parameterCode}' is duplicated within this test`,
          );
        } else {
          seenParamCodes.add(pKey);
        }
      }
    }

    // ── 8. Write every test that never accumulated an error, in one
    //        transaction; skip the rest and report why. A test whose error
    //        surfaced only in step 7 (e.g. a duplicate) is still sitting in
    //        `validTests` from step 6 — filter those out here rather than
    //        threading a second removal through step 7's loop. ────────────
    const testsToWrite = validTests.filter(
      ({ dto }) => !rowLabelsWithErrors.has(dto.rowLabel ?? ''),
    );
    const skippedByRowLabel = new Map<string, string[]>();
    for (const message of errors) {
      const colonIdx = message.indexOf(': ');
      const rowLabel = colonIdx === -1 ? message : message.slice(0, colonIdx);
      const reason = colonIdx === -1 ? message : message.slice(colonIdx + 2);
      const list = skippedByRowLabel.get(rowLabel);
      if (list) list.push(reason);
      else skippedByRowLabel.set(rowLabel, [reason]);
    }
    const skipped: ImportXlsxSkippedTest[] = [
      ...skippedByRowLabel.entries(),
    ].map(([rowLabel, errs]) => ({ rowLabel, errors: errs }));

    let created = 0;
    let updated = 0;
    await this.prisma.withTenant(tenantId, async (tx) => {
      const now = new Date();
      for (const { dto, matchedId } of testsToWrite) {
        const { samples, resultParams, rowLabel: _rowLabel, ...scalars } = dto;
        const cleanSamples = this.cleanImportSampleDtos(samples);
        const cleanParams = this.cleanImportParamDtos(resultParams);
        if (matchedId) {
          await tx.labTest.update({ where: { id: matchedId }, data: scalars });
          const where = { labTestId: matchedId, tenantId, deletedAt: null };
          await tx.labTestSample.updateMany({
            where,
            data: { deletedAt: now },
          });
          await this.createSamples(
            tx,
            tenantId,
            masterData.branchId,
            matchedId,
            cleanSamples,
          );
          await this.upsertParamsByCode(
            tx,
            tenantId,
            masterData.branchId,
            matchedId,
            cleanParams,
            now,
          );
          updated += 1;
        } else {
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
            cleanSamples,
          );
          await this.createParams(
            tx,
            tenantId,
            masterData.branchId,
            labTest.id,
            cleanParams,
          );
          created += 1;
        }
      }
    });

    return { created, updated, skipped };
  }

  /**
   * The real human-readable message from a `ValidationException` (or any
   * `KaltrosException`). `HttpException.message` is NOT this — Nest derives it
   * from the exception's constructor name when the `super()` response is an
   * object (as `KaltrosException` always passes), so the actual message must
   * be read back out of `getResponse().error.message`.
   */
  private validationMessage(e: ValidationException): string {
    const response = e.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'error' in response
    ) {
      const err = (response as { error?: { message?: unknown } }).error;
      if (typeof err?.message === 'string') return err.message;
    }
    return e.message;
  }

  /**
   * Strip the import-only `rowLabel` field from a set of assembled sample
   * rows before handing them to `createSamples` (which passes them straight
   * to Prisma's `createMany` — an unknown column throws).
   */
  private cleanImportSampleDtos(
    samples: ImportXlsxSampleRowDto[] | undefined,
  ): CreateLabTestDto['samples'] | undefined {
    return samples?.map(({ rowLabel: _rowLabel, ...rest }) => rest);
  }

  /**
   * Strip the import-only `rowLabel`/`reflexTestNames` fields from a set of
   * assembled result-parameter rows (and their nested reference ranges/
   * values) before handing them to `createParams`. `reflexTestNames` is
   * export-only/informational (no name→id lookup is built for v1 — see the
   * DTO's doc comment) so it never reaches the write payload.
   */
  private cleanImportParamDtos(
    params: ImportXlsxResultParamRowDto[] | undefined,
  ): LabTestResultParamDto[] | undefined {
    return params?.map(
      ({
        rowLabel: _rowLabel,
        reflexTestNames: _reflexTestNames,
        referenceRanges,
        referenceValues,
        ...rest
      }) => ({
        ...rest,
        referenceRanges: referenceRanges?.map(({ rowLabel: _rrl, ...r }) => r),
        referenceValues: referenceValues?.map(({ rowLabel: _vrl, ...v }) => v),
      }),
    );
  }

  /**
   * Flatten a (possibly nested, e.g. a `samples[0].containerType` failure)
   * class-validator error into `{ rowLabel, message }` pairs, recursing
   * through `children` since a parent-level error (e.g. on `samples`)
   * carries no `constraints` of its own — only its children do. Each nested
   * item (a sample/result-param/range/value DTO instance) carries its OWN
   * `rowLabel` on `error.target` when set; falls back to the parent test's
   * row-span label otherwise.
   */
  private flattenValidationMessages(
    error: {
      property: string;
      constraints?: Record<string, string>;
      children?: unknown[];
      target?: unknown;
    },
    fallbackRowLabel: string,
  ): { rowLabel: string; message: string }[] {
    const ownRowLabel =
      (error.target as { rowLabel?: string } | undefined)?.rowLabel ??
      fallbackRowLabel;
    const messages: { rowLabel: string; message: string }[] = [];
    if (error.constraints) {
      messages.push(
        ...Object.values(error.constraints).map((m) => ({
          rowLabel: ownRowLabel,
          message: this.humanizeValidationMessage(error.property, m),
        })),
      );
    }
    for (const child of error.children ?? []) {
      messages.push(
        ...this.flattenValidationMessages(
          child as {
            property: string;
            constraints?: Record<string, string>;
            children?: unknown[];
            target?: unknown;
          },
          ownRowLabel,
        ),
      );
    }
    return messages;
  }

  /**
   * Rewrite a raw class-validator constraint message (which always embeds
   * the DTO's camelCase property name, e.g. "priceMsrp must be an integer
   * number") into one naming the actual Excel column a spreadsheet user
   * sees (e.g. "Price MSRP must be an integer number"). Falls back to the
   * bare property name only if it's not in `FIELD_TO_COLUMN_LABEL` (should
   * not happen for any field on the import DTOs — see that map's doc
   * comment — but never worse than the previous, fully-raw message).
   */
  private humanizeValidationMessage(property: string, message: string): string {
    const label = FIELD_TO_COLUMN_LABEL[property] ?? property;
    // Replace whole-word occurrences only, so a property name that happens
    // to be a substring of another word in the message is left alone.
    const fieldPattern = new RegExp(
      `\\b${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'g',
    );
    let result = message.replace(fieldPattern, label);
    // An @IsEnum failure lists valid values by raw enum member (e.g.
    // "SINGLE_STEP, MULTI_STEP") — swap each for the label the user actually
    // types into the sheet.
    for (const [value, valueLabel] of Object.entries(ENUM_VALUE_TO_LABEL)) {
      const valuePattern = new RegExp(`\\b${value}\\b`, 'g');
      result = result.replace(valuePattern, valueLabel);
    }
    return result;
  }

  // ── Excel import parsing helpers (single flat sheet) ────────────────────

  /** A cell's value as a trimmed string (handles ExcelJS rich-text/formula cells). */
  private cellToString(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && 'text' in (value as object)) {
      return this.asString((value as { text: unknown }).text).trim();
    }
    if (typeof value === 'object' && 'result' in (value as object)) {
      return this.asString((value as { result: unknown }).result).trim();
    }
    return this.asString(value).trim();
  }

  /** Safely stringify a value of unknown shape without risking `[object Object]`. */
  private asString(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value instanceof Date) return value.toISOString();
    return '';
  }

  /** Coerce one cell's raw (already-stringified) value according to the
   * target field's declared type. `str === ''` → `undefined` (blank cell). */
  private coerceCellValue(field: string, str: string): unknown {
    if (str === '') return undefined;
    if (BOOLEAN_FIELDS.has(field)) {
      return ['true', 'yes', '1'].includes(str.toLowerCase());
    }
    if (field === 'isActive') {
      return STATUS_LABEL_TO_ACTIVE[str] ?? str;
    }
    if (field === 'scheduleDays') {
      return str
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => DAY_LABEL_TO_ENUM[s] ?? s);
    }
    if (SEMICOLON_LIST_FIELDS.has(field)) {
      return str
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (field === 'discountCapPct') {
      // "20%" or "20" — strip a trailing percent sign before numeric coercion.
      const n = Number(str.replace(/%\s*$/, ''));
      return Number.isFinite(n) ? Math.round(n) : str;
    }
    if (INTEGER_FIELDS.has(field)) {
      const n = Number(str);
      return Number.isFinite(n) ? Math.round(n) : str;
    }
    if (NUMERIC_FIELDS.has(field)) {
      const n = Number(str);
      return Number.isFinite(n) ? n : str;
    }
    if (ENUM_LABEL_FIELDS[field]) {
      return this.lookupEnumLabel(field, str) ?? str;
    }
    return str;
  }

  /** Case-insensitive lookup into `ENUM_LABEL_FIELDS[field]` — the reference
   * file itself uses inconsistent casing for free-typed shorthand (e.g.
   * "yrs" vs "Yrs", "day" vs "Days"), so an exact-case match would reject
   * perfectly legible data. Built once per field and cached. */
  private static readonly LOWERCASED_ENUM_LABELS = new Map<
    string,
    Map<string, string>
  >();
  private lookupEnumLabel(field: string, str: string): string | undefined {
    let map = LabTestService.LOWERCASED_ENUM_LABELS.get(field);
    if (!map) {
      const labels = ENUM_LABEL_FIELDS[field] ?? {};
      map = new Map(
        Object.entries(labels).map(([label, value]) => [
          label.toLowerCase(),
          value,
        ]),
      );
      LabTestService.LOWERCASED_ENUM_LABELS.set(field, map);
    }
    return map.get(str.toLowerCase());
  }

  /**
   * Convert a 12-hour clock string (e.g. "11:00 AM", "2:30 pm") to 24-hour
   * `HH:mm`. Returns the original string unchanged if it doesn't match the
   * expected 12h shape (so a malformed value surfaces as a normal
   * `Matches(HH_MM)` validation failure instead of silently disappearing).
   */
  private to24Hour(value: string): string {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
    if (!m) return value;
    let hour = Number(m[1]);
    const minute = m[2];
    const period = m[3]!.toUpperCase();
    if (period === 'AM') {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }

  /** Batch-resolve a set of catalogue names (case-insensitive) → ids. */
  private async namesToIds(
    model: 'department' | 'category' | 'subCategory',
    tenantId: string,
    namesRaw: (string | undefined)[],
  ): Promise<Map<string, string>> {
    const names = [
      ...new Set(
        namesRaw
          .map((n) => (typeof n === 'string' ? n.trim() : ''))
          .filter(Boolean),
      ),
    ];
    const map = new Map<string, string>();
    if (!names.length) return map;
    // `mode: 'insensitive'` — the sheet's Department/Category/Sub Category
    // text is free-typed by a business user and won't reliably match the
    // catalogue's stored casing (e.g. reference file has "BIOCHEMISTRY" for
    // a catalogue row actually named "Biochemistry").
    const where = {
      tenantId,
      deletedAt: null,
      OR: names.map((name) => ({
        name: { equals: name, mode: 'insensitive' as const },
      })),
    };
    const rows =
      model === 'department'
        ? await this.prisma.department.findMany({
            where,
            select: { id: true, name: true },
          })
        : model === 'category'
          ? await this.prisma.category.findMany({
              where,
              select: { id: true, name: true },
            })
          : await this.prisma.subCategory.findMany({
              where,
              select: { id: true, name: true },
            });
    for (const r of rows) map.set(r.name.toLowerCase(), r.id);
    return map;
  }

  /** Resolve one classification-name field (currently holding the raw sheet
   * text) to an id, or record a lookup error. Blank stays blank/undefined. */
  private resolveOptionalNameField(
    raw: string | undefined,
    label: string,
    nameToId: Map<string, string>,
    rowLabel: string,
    errors: string[],
  ): string | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const id = nameToId.get(raw.trim().toLowerCase());
    if (!id) {
      errors.push(`${rowLabel}: ${label} '${raw}' not found`);
      return undefined;
    }
    return id;
  }

  /**
   * Resolve every canonical `XLSX_COLUMNS` position this parser needs, once
   * per import, keyed by a friendly name. Several header labels repeat
   * (`Parameter Name`/`Method`/`GENDER`/`AGE FROM`/`AGE FROM UNIT`/`AGE TO`/
   * `AGE TO UNIT`/`ABNORMAL FLAG LOGIC` each appear in the Result Parameter
   * block AND the Reference Range block AND/or the Reference Value block —
   * see the header-count check in the reference CSV), so `occurrence`
   * disambiguates which one a given field means (0 = Result Parameter
   * block's own copy, 1 = Reference Range block's copy, 2 = Reference Value
   * block's copy, matching left-to-right order in `XLSX_COLUMNS`).
   */
  private buildColumnIndex(): ColumnIndex {
    const idx = (label: string, occurrence = 0): number => {
      let seen = -1;
      for (let i = 0; i < XLSX_COLUMNS.length; i++) {
        if (XLSX_COLUMNS[i] === label) {
          seen += 1;
          if (seen === occurrence) return i;
        }
      }
      throw new Error(
        `Unknown column label '${label}' (occurrence ${occurrence})`,
      );
    };
    return {
      testName: idx('Test Name'),
      sampleName: idx('Sample Name'),
      sampleType: idx('Sample Type'),
      containerType: idx('Conatiner Type'),
      sampleSize: idx('Sample Size'),
      collectionMethod: idx('collection method'),
      numberOfSamples: idx('number of samples'),
      stability: idx('stability'),
      transportTemperature: idx('transport temperature'),
      preservative: idx('preservative'),
      sampleHandlingInstructions: idx('sample handling instructions'),
      fastingRequired: idx('fasting required'),
      lightProtection: idx('light protection'),
      setAsDefault: idx('set as default'),
      groupName: idx('Group Name'),
      groupLayout: idx('Group Layout'),
      groupSettings: idx('Group Settings'),
      paramName: idx('Parameter Name', 0),
      parameterCode: idx('Parameter Code'),
      paramMethod: idx('Method', 0),
      reportingUnit: idx('reporting unit'),
      resultType: idx('Result type'),
      parameterType: idx('parameter type'),
      nabl: idx('NABL'),
      cap: idx('CAP'),
      resultRoundingType: idx('result rounding type'),
      iconSettings: idx('icon settings'),
      reflexTest: idx('reflex test'),
      calculationFormula: idx('calculation formula'),
      allowableUnits: idx('allowable units'),
      paramNotes: idx('Notes'),
      rangeMethod: idx('Method', 1),
      rangeGender: idx('GENDER', 0),
      rangeAgeFrom: idx('AGE FROM', 0),
      rangeAgeFromUnit: idx('AGE FROM UNIT', 0),
      rangeAgeTo: idx('AGE TO', 0),
      rangeAgeToUnit: idx('AGE TO UNIT', 0),
      lowerLimit: idx('LOWER LIMIT'),
      upperLimit: idx('UPPER LIMIT'),
      criticalMin: idx('CRITICAL MIN'),
      criticalMax: idx('CRITICAL MAX'),
      displayOfRange: idx('DISPLAY OF REFERENCE RANGE'),
      rangeFlag: idx('ABNORMAL FLAG LOGIC', 0),
      valueMethod: idx('Method', 2),
      valueGender: idx('GENDER', 1),
      valueAgeFrom: idx('AGE FROM', 1),
      valueAgeFromUnit: idx('AGE FROM UNIT', 1),
      valueAgeTo: idx('AGE TO', 1),
      valueAgeToUnit: idx('AGE TO UNIT', 1),
      displayOfValue: idx('DISPLAY OF REFERENCE VALUE'),
      valueFlag: idx('ABNORMAL FLAG LOGIC', 1),
    };
  }

  /** Assemble a test-span's FIRST row into the Test-level scalar `ImportXlsxTestRowDto` fields. */
  private buildTestScalarsDto(
    firstRow: { v: string[] },
    rowLabel: string,
  ): ImportXlsxTestRowDto {
    const v = firstRow.v;
    const at = (i: number) => v[i] ?? '';
    const dto = new ImportXlsxTestRowDto();
    dto.rowLabel = rowLabel;
    dto.testName = at(0);
    dto.testDisplayName = this.coerceCellValue('testDisplayName', at(1)) as
      | string
      | undefined;
    dto.testCode = at(2);
    dto.aka = this.coerceCellValue('aka', at(3)) as string | undefined;
    // Department/Category/Sub Category are resolved name→id AFTER this
    // build step (see step 5 in `importXlsx`) — stash the raw name here.
    dto.departmentId = at(4) || undefined;
    dto.categoryId = at(5) || undefined;
    dto.subCategoryId = at(6) || undefined;
    dto.processMethod = this.coerceCellValue('processMethod', at(7)) as
      | ProcessMethod
      | undefined;
    dto.approvalWorkflowId = at(8) || undefined;
    dto.isMandatoryTest = this.coerceCellValue('isMandatoryTest', at(9)) as
      | boolean
      | undefined;
    // "Mandatory Department" (added on top of the reference file's 117
    // columns — see the doc comment on `ImportXlsxTestRowDto`) is resolved
    // name→id AFTER this build step, same as departmentId/categoryId above.
    dto.mandatoryDeptId = at(10) || undefined;
    dto.isRepeatIntervalRestriction = this.coerceCellValue(
      'isRepeatIntervalRestriction',
      at(11),
    ) as boolean | undefined;
    dto.repeatIntervalValue = this.coerceCellValue(
      'repeatIntervalValue',
      at(12),
    ) as number | undefined;
    dto.repeatIntervalUnit = this.coerceCellValue(
      'repeatIntervalUnit',
      at(13),
    ) as RepeatIntervalUnit | undefined;
    dto.isHideInOrderScreen = this.coerceCellValue(
      'isHideInOrderScreen',
      at(14),
    ) as boolean | undefined;
    dto.clinicalTags = this.coerceCellValue('clinicalTags', at(15)) as
      | string[]
      | undefined;
    dto.icdCode = at(16) || undefined;
    dto.loincCode = at(17) || undefined;
    dto.reportTemplateId = at(18) || undefined;
    dto.samplePriorityType = this.coerceCellValue(
      'samplePriorityType',
      at(19),
    ) as SamplePriority | undefined;
    dto.pdfSettingsId = at(20) || undefined;
    dto.imageSettingsId = at(21) || undefined;
    dto.isEnableCms = this.coerceCellValue('isEnableCms', at(22)) as
      | boolean
      | undefined;
    dto.priceMsrp = this.coerceCellValue('priceMsrp', at(23)) as
      | number
      | undefined;
    dto.priceMaximum = this.coerceCellValue('priceMaximum', at(24)) as
      | number
      | undefined;
    dto.priceMinimum = this.coerceCellValue('priceMinimum', at(25)) as
      | number
      | undefined;
    dto.priceOriginal = this.coerceCellValue('priceOriginal', at(26)) as
      | number
      | undefined;
    dto.franchisePrice = this.coerceCellValue('franchisePrice', at(27)) as
      | number
      | undefined;
    dto.emergencyPrice = this.coerceCellValue('emergencyPrice', at(28)) as
      | number
      | undefined;
    dto.isAllowPriceOverride = this.coerceCellValue(
      'isAllowPriceOverride',
      at(29),
    ) as boolean | undefined;
    dto.discountCapPct = this.coerceCellValue('discountCapPct', at(30)) as
      | number
      | undefined;
    dto.tatMinValue = this.coerceCellValue('tatMinValue', at(31)) as
      | number
      | undefined;
    dto.tatMinUnit = this.coerceCellValue('tatMinUnit', at(32)) as
      | TatUnit
      | undefined;
    dto.tatMaxValue = this.coerceCellValue('tatMaxValue', at(33)) as
      | number
      | undefined;
    dto.tatMaxUnit = this.coerceCellValue('tatMaxUnit', at(34)) as
      | TatUnit
      | undefined;
    dto.scheduleDays = this.coerceCellValue('scheduleDays', at(35)) as
      | DayOfWeek[]
      | undefined;
    dto.scheduleFrom = at(36) ? this.to24Hour(at(36)) : undefined;
    dto.scheduleTo = at(37) ? this.to24Hour(at(37)) : undefined;
    dto.procTimeMinValue = this.coerceCellValue('procTimeMinValue', at(38)) as
      | number
      | undefined;
    dto.procTimeMinUnit = this.coerceCellValue('procTimeMinUnit', at(39)) as
      | TatUnit
      | undefined;
    dto.procTimeMaxValue = this.coerceCellValue('procTimeMaxValue', at(40)) as
      | number
      | undefined;
    dto.procTimeMaxUnit = this.coerceCellValue('procTimeMaxUnit', at(41)) as
      | TatUnit
      | undefined;
    dto.approvalDurationMinValue = this.coerceCellValue(
      'approvalDurationMinValue',
      at(42),
    ) as number | undefined;
    dto.approvalDurationMinUnit = this.coerceCellValue(
      'approvalDurationMinUnit',
      at(43),
    ) as TatUnit | undefined;
    dto.approvalDurationMaxValue = this.coerceCellValue(
      'approvalDurationMaxValue',
      at(44),
    ) as number | undefined;
    dto.approvalDurationMaxUnit = this.coerceCellValue(
      'approvalDurationMaxUnit',
      at(45),
    ) as TatUnit | undefined;
    dto.reportingTimeFrom = at(46) ? this.to24Hour(at(46)) : undefined;
    dto.reportingTimeTo = at(47) ? this.to24Hour(at(47)) : undefined;
    // at(48)="Bill Only Test", at(50)="Outsource", at(52)="Sample Flow" — no
    // matching DB field; read but intentionally discarded (export-only).
    dto.isAllowDiscounts = this.coerceCellValue('isAllowDiscounts', at(49)) as
      | boolean
      | undefined;
    dto.isPreferenceTest = this.coerceCellValue('isPreferenceTest', at(51)) as
      | boolean
      | undefined;
    dto.isActive = this.coerceCellValue('isActive', at(53)) as
      | boolean
      | undefined;
    dto.usefulFor = at(109) || undefined;
    dto.interpretationOfResults = at(110) || undefined;
    dto.limitations = at(111) || undefined;
    dto.remarks = at(112) || undefined;
    dto.references = at(113) || undefined;
    return dto;
  }

  /**
   * Build a test's sample list from its row-span: Samples align
   * POSITIONALLY — the Nth row of the span (that has any non-blank Sample
   * column) contributes the Nth sample. A row with every Sample column blank
   * contributes no sample (the Parameter/Range/Value "track" may simply be
   * longer for that test).
   */
  private buildSamplesForSpan(
    rows: { rowNum: number; v: string[] }[],
    COL: ColumnIndex,
  ): ImportXlsxSampleRowDto[] {
    const samples: ImportXlsxSampleRowDto[] = [];
    for (const row of rows) {
      const v = row.v;
      const sampleName = v[COL.sampleName] ?? '';
      const sampleType = v[COL.sampleType] ?? '';
      const hasAny =
        sampleName !== '' ||
        sampleType !== '' ||
        (v[COL.containerType] ?? '') !== '' ||
        (v[COL.sampleSize] ?? '') !== '' ||
        (v[COL.collectionMethod] ?? '') !== '' ||
        (v[COL.numberOfSamples] ?? '') !== '' ||
        (v[COL.stability] ?? '') !== '' ||
        (v[COL.transportTemperature] ?? '') !== '' ||
        (v[COL.preservative] ?? '') !== '' ||
        (v[COL.sampleHandlingInstructions] ?? '') !== '' ||
        (v[COL.fastingRequired] ?? '') !== '' ||
        (v[COL.lightProtection] ?? '') !== '' ||
        (v[COL.setAsDefault] ?? '') !== '';
      if (!hasAny) continue;
      const dto = new ImportXlsxSampleRowDto();
      dto.rowLabel = `Row ${row.rowNum}`;
      dto.sampleNameId = sampleName || undefined;
      dto.sampleType = sampleType || undefined;
      dto.containerType = this.coerceCellValue(
        'containerType',
        v[COL.containerType] ?? '',
      ) as ContainerType | undefined;
      dto.sampleSize = v[COL.sampleSize] || undefined;
      dto.collectionMethod = v[COL.collectionMethod] || undefined;
      dto.numberOfSamples = this.coerceCellValue(
        'numberOfSamples',
        v[COL.numberOfSamples] ?? '',
      ) as number | undefined;
      dto.stability = v[COL.stability] || undefined;
      dto.transportTemperature = v[COL.transportTemperature] || undefined;
      dto.preservative = v[COL.preservative] || undefined;
      dto.sampleHandlingInstructions =
        v[COL.sampleHandlingInstructions] || undefined;
      dto.isFastingRequired = this.coerceCellValue(
        'isFastingRequired',
        v[COL.fastingRequired] ?? '',
      ) as boolean | undefined;
      dto.isLightProtection = this.coerceCellValue(
        'isLightProtection',
        v[COL.lightProtection] ?? '',
      ) as boolean | undefined;
      dto.isDefault = this.coerceCellValue(
        'isDefault',
        v[COL.setAsDefault] ?? '',
      ) as boolean | undefined;
      samples.push(dto);
    }
    return samples;
  }

  /**
   * Build a test's result-parameter list (with nested reference ranges/
   * values) from its row-span, per the contiguous-block rule: a row whose
   * "Parameter Name" is non-blank starts a new parameter block (its own
   * columns filled, plus its first range/value if present on that same
   * row); continuation rows (blank Parameter Name) contribute only their
   * Reference Range and/or Reference Value columns to the CURRENT (most
   * recent) parameter, until the row-span ends or another non-blank
   * Parameter Name starts the next block.
   */
  private buildParamsForSpan(
    rows: { rowNum: number; v: string[] }[],
    COL: ColumnIndex,
    errors: string[],
  ): ImportXlsxResultParamRowDto[] {
    const params: ImportXlsxResultParamRowDto[] = [];
    let current: ImportXlsxResultParamRowDto | null = null;
    let ownerRowLabel = '';

    const rangeHasAny = (v: string[]) =>
      (v[COL.rangeMethod] ?? '') !== '' ||
      (v[COL.rangeGender] ?? '') !== '' ||
      (v[COL.rangeAgeFrom] ?? '') !== '' ||
      (v[COL.rangeAgeFromUnit] ?? '') !== '' ||
      (v[COL.rangeAgeTo] ?? '') !== '' ||
      (v[COL.rangeAgeToUnit] ?? '') !== '' ||
      (v[COL.lowerLimit] ?? '') !== '' ||
      (v[COL.upperLimit] ?? '') !== '' ||
      (v[COL.criticalMin] ?? '') !== '' ||
      (v[COL.criticalMax] ?? '') !== '' ||
      (v[COL.displayOfRange] ?? '') !== '' ||
      (v[COL.rangeFlag] ?? '') !== '';

    const valueHasAny = (v: string[]) =>
      (v[COL.valueMethod] ?? '') !== '' ||
      (v[COL.valueGender] ?? '') !== '' ||
      (v[COL.valueAgeFrom] ?? '') !== '' ||
      (v[COL.valueAgeFromUnit] ?? '') !== '' ||
      (v[COL.valueAgeTo] ?? '') !== '' ||
      (v[COL.valueAgeToUnit] ?? '') !== '' ||
      (v[COL.displayOfValue] ?? '') !== '' ||
      (v[COL.valueFlag] ?? '') !== '';

    for (const row of rows) {
      const v = row.v;
      const paramName = v[COL.paramName] ?? '';
      if (paramName !== '') {
        const dto = new ImportXlsxResultParamRowDto();
        dto.rowLabel = `Row ${row.rowNum}`;
        dto.groupName = v[COL.groupName] || undefined;
        dto.groupLayoutId = v[COL.groupLayout] || undefined;
        dto.groupSettingsId = v[COL.groupSettings] || undefined;
        dto.parameterName = paramName;
        dto.parameterCode = v[COL.parameterCode] ?? '';
        dto.method = v[COL.paramMethod] || undefined;
        dto.reportingUnit = v[COL.reportingUnit] || undefined;
        dto.resultType = (this.coerceCellValue(
          'resultType',
          v[COL.resultType] ?? '',
        ) ?? 'QUANTITATIVE') as ResultType;
        dto.parameterType = this.coerceCellValue(
          'parameterType',
          v[COL.parameterType] ?? '',
        ) as ParameterType | undefined;
        dto.isNabl = this.coerceCellValue('isNabl', v[COL.nabl] ?? '') as
          | boolean
          | undefined;
        dto.isCap = this.coerceCellValue('isCap', v[COL.cap] ?? '') as
          | boolean
          | undefined;
        dto.resultRoundingType = this.coerceCellValue(
          'resultRoundingType',
          v[COL.resultRoundingType] ?? '',
        ) as ResultRounding | undefined;
        dto.iconSettingsId = v[COL.iconSettings] || undefined;
        // `imgae settings` (sic) — no matching DB field; not read.
        dto.reflexTestNames = v[COL.reflexTest] || undefined;
        dto.calculationFormula = v[COL.calculationFormula] || undefined;
        dto.allowableUnits = v[COL.allowableUnits] || undefined;
        dto.notes = v[COL.paramNotes] || undefined;
        dto.referenceRanges = [];
        dto.referenceValues = [];
        params.push(dto);
        current = dto;
        ownerRowLabel = `Row ${row.rowNum}`;
      }

      if (!current) {
        if (rangeHasAny(v) || valueHasAny(v)) {
          errors.push(
            `Row ${row.rowNum}: a Reference Range/Value is present but no Result Parameter has been introduced yet`,
          );
        }
        continue;
      }

      if (rangeHasAny(v)) {
        const range = new ImportXlsxReferenceRangeRowDto();
        range.rowLabel = `Row ${row.rowNum}`;
        range.method = v[COL.rangeMethod] || undefined;
        range.gender = this.coerceCellValue(
          'gender',
          v[COL.rangeGender] ?? '',
        ) as ReferenceGender | undefined;
        range.ageFrom = this.coerceCellValue(
          'ageFrom',
          v[COL.rangeAgeFrom] ?? '',
        ) as number | undefined;
        range.ageFromUnit = this.coerceCellValue(
          'ageFromUnit',
          v[COL.rangeAgeFromUnit] ?? '',
        ) as AgeUnit | undefined;
        range.ageTo = this.coerceCellValue('ageTo', v[COL.rangeAgeTo] ?? '') as
          | number
          | undefined;
        range.ageToUnit = this.coerceCellValue(
          'ageToUnit',
          v[COL.rangeAgeToUnit] ?? '',
        ) as AgeUnit | undefined;
        range.lowerLimit = this.coerceCellValue(
          'lowerLimit',
          v[COL.lowerLimit] ?? '',
        ) as number | undefined;
        range.upperLimit = this.coerceCellValue(
          'upperLimit',
          v[COL.upperLimit] ?? '',
        ) as number | undefined;
        range.criticalMin = this.coerceCellValue(
          'criticalMin',
          v[COL.criticalMin] ?? '',
        ) as number | undefined;
        range.criticalMax = this.coerceCellValue(
          'criticalMax',
          v[COL.criticalMax] ?? '',
        ) as number | undefined;
        range.displayOfReferenceRange = v[COL.displayOfRange] || undefined;
        range.abnormalFlagLogic = this.coerceCellValue(
          'abnormalFlagLogic',
          v[COL.rangeFlag] ?? '',
        ) as AbnormalFlag | undefined;
        this.assertImportRangeQuiet(range, range.rowLabel, errors);
        current.referenceRanges = current.referenceRanges ?? [];
        current.referenceRanges.push(range);
      }

      if (valueHasAny(v)) {
        const value = new ImportXlsxReferenceValueRowDto();
        value.rowLabel = `Row ${row.rowNum}`;
        value.method = v[COL.valueMethod] || undefined;
        value.gender = this.coerceCellValue(
          'gender',
          v[COL.valueGender] ?? '',
        ) as ReferenceGender | undefined;
        value.ageFrom = this.coerceCellValue(
          'ageFrom',
          v[COL.valueAgeFrom] ?? '',
        ) as number | undefined;
        value.ageFromUnit = this.coerceCellValue(
          'ageFromUnit',
          v[COL.valueAgeFromUnit] ?? '',
        ) as AgeUnit | undefined;
        value.ageTo = this.coerceCellValue('ageTo', v[COL.valueAgeTo] ?? '') as
          | number
          | undefined;
        value.ageToUnit = this.coerceCellValue(
          'ageToUnit',
          v[COL.valueAgeToUnit] ?? '',
        ) as AgeUnit | undefined;
        value.normalValueText = v[COL.displayOfValue] ?? '';
        value.abnormalFlagLogic = this.coerceCellValue(
          'abnormalFlagLogic',
          v[COL.valueFlag] ?? '',
        ) as AbnormalFlag | undefined;
        current.referenceValues = current.referenceValues ?? [];
        current.referenceValues.push(value);
      }
    }
    void ownerRowLabel;

    return params;
  }

  /** Validate a result parameter + its embedded reference ranges (import path). */
  private assertImportParam(p: ImportXlsxResultParamRowDto): void {
    if (p.parameterType === ParameterType.CALCULATED && !p.calculationFormula) {
      throw new ValidationException(
        'calculationFormula is required when parameterType is CALCULATED',
        { parameterCode: p.parameterCode },
      );
    }
    (p.referenceRanges ?? []).forEach((r) => this.assertRange(r));
  }

  /** Validate a range row's numeric bounds without throwing (aggregate instead). */
  private assertImportRangeQuiet(
    r: ImportXlsxReferenceRangeRowDto,
    rowLabel: string | undefined,
    errors: string[],
  ): void {
    try {
      this.assertRange(r);
    } catch (e) {
      if (e instanceof ValidationException) {
        errors.push(`${rowLabel}: ${this.validationMessage(e)}`);
        return;
      }
      throw e;
    }
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
    samples: CreateLabTestDto['samples'] | undefined,
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

  /**
   * Xlsx-import update path only: replace a test's result parameters while
   * preserving the DB `id` of any parameter whose `parameterCode` (case-
   * insensitive) matches one that's already active on this test. Other
   * modules hold logical (non-FK) references to `LabTestResultParam.id` —
   * `LabReportResultValue.resultParamId`, `CriticalAlert.resultParamId`,
   * `OutOfRangeFlag.resultParamId` — so a blind delete-and-recreate on every
   * re-import (what `createParams` does) would silently orphan any existing
   * lab report tied to that parameter. A matched parameter's scalars are
   * patched in place and its reference ranges/values are fully replaced
   * (those have no natural key in the xlsx format — full-replace there
   * matches `LabTestService.update()`'s existing contract); an unmatched
   * uploaded code creates a new parameter; an existing active parameter
   * whose code no longer appears in the upload is soft-deleted.
   */
  private async upsertParamsByCode(
    tx: Prisma.TransactionClient,
    tenantId: string | null,
    branchId: string | null,
    labTestId: string,
    params: LabTestResultParamDto[] | undefined,
    now: Date,
  ): Promise<void> {
    const existing = await tx.labTestResultParam.findMany({
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
        await tx.labTestResultParam.update({
          where: { id: existingId },
          data: {
            ...paramScalars,
            reflexTests: (reflexTests ??
              []) as unknown as Prisma.InputJsonValue,
          },
        });
        paramId = existingId;
        await tx.labTestReferenceRange.updateMany({
          where: { paramId, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.labTestReferenceValue.updateMany({
          where: { paramId, tenantId, deletedAt: null },
          data: { deletedAt: now },
        });
      } else {
        const created = await tx.labTestResultParam.create({
          data: {
            ...paramScalars,
            reflexTests: (reflexTests ??
              []) as unknown as Prisma.InputJsonValue,
            tenantId,
            branchId,
            labTestId,
          },
        });
        paramId = created.id;
      }

      if (referenceRanges?.length) {
        await tx.labTestReferenceRange.createMany({
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
        await tx.labTestReferenceValue.createMany({
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
      await tx.labTestResultParam.updateMany({
        where: { id: { in: droppedIds } },
        data: { deletedAt: now },
      });
      await tx.labTestReferenceRange.updateMany({
        where: { paramId: { in: droppedIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.labTestReferenceValue.updateMany({
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

  /**
   * Derive a short parameter code from a parameter name, for a brand-new
   * "Results" sheet row that has no `Parameter Code` column to read one from
   * (that column isn't on the Results tab — see `RESULT_PARAMS_SHEET_FIELDS`).
   * Not guaranteed globally unique; a genuine collision within the same test
   * surfaces as a normal 409 via the DB's partial unique index.
   */
  private slugifyParamCode(parameterName: string | undefined): string {
    const slug = (parameterName ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return (slug || 'PARAM').slice(0, 50);
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

  /**
   * Human-readable reason for a per-row import/sync failure. Maps a Prisma
   * unique-constraint violation (P2002) to a friendly message; falls back to a
   * generic message for anything else (the row is recorded as failed, not thrown).
   */
  private conflictReason(
    e: unknown,
    testName: string,
    testCode: string,
  ): string {
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
