import { Injectable } from '@nestjs/common';
import {
  LabReportHistory,
  LabReportStatus,
  Prisma,
  ResultValueSource,
  SampleStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListLabReportsDto } from './dto/list-lab-reports.dto';
import { UpsertResultValuesDto } from './dto/upsert-result-values.dto';
import { ReferenceRangeQueryDto } from './dto/reference-range-query.dto';
import { TrendReportQueryDto } from './dto/trend-report-query.dto';
import {
  CreateLabReportNoteDto,
  ListLabReportNotesDto,
  PLAIN_NOTE_CATEGORIES,
} from './dto/lab-report-note.dto';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { GeneratePdfDto, SigningAuthorityDto } from '../pdf-report-template/dto/generate-pdf.dto';
import {
  LAB_REPORT_ALLOWED_FROM,
  LAB_REPORT_DETAIL_INCLUDE,
  LAB_REPORT_LIST_INCLUDE,
  LabReportContentSections,
  LabReportDetailApiResponse,
  LabReportDetailWithContent,
  LabReportResultParam,
  LabReportStatusCounts,
  LabReportTransitionAction,
  LabReportWorklistRow,
  toWorklistRow,
} from './entities/lab-report.entity';
import { LabReportOptions } from './entities/lab-report-options.entity';
import {
  ActiveBranchRequiredException,
  InvalidLabReportTransitionException,
  LabReportLockedException,
  LabReportNotesRequiredException,
  LabReportNotFoundException,
  LabTestCatalogueMissingException,
  UnlockNotPermittedException,
  NoActivePrintTemplateException,
  AmbiguousPrintTemplateException,
} from './exceptions/lab-report.exceptions';
import {
  computeTrendFlag,
  genderMatches,
  patientAgeInDays,
  rangeAgeInDays,
} from './utils/reference-range.util';

/**
 * Technician Reporting core module: worklist, Test Entry (result values), and
 * the status-lifecycle gates (Save/Submit/Validate/Edit/Reject/Approve/Publish/
 * Error Reported/Resubmit), per LABORATORY.docx §2, §4, §6.
 *
 * Tenant-scoped + branch-level (CLAUDE.md §4.5-4.7): `tenantId`/`branchId` come
 * from the request context, never the body. `LabReport` rows are created only
 * once a sample is accepted — see `ensureCreatedForAcceptedItem` — not at raw
 * order/order-item creation.
 */
@Injectable()
export class LabReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfReportTemplateService: PdfReportTemplateService,
  ) {}

  // ── Creation (triggered by Accession's sample-accept signal) ──────────────

  /**
   * Create a `LabReport` for an order item once its sample is accepted, if one
   * doesn't already exist (idempotent). Real trigger: called from
   * `AccessionSampleService` when a sample transitions to `ACCEPTED`, once per
   * `OrderItem` linked to that sample (via `AccessionSampleTest` — one sample
   * can serve several order items). Pass the caller's transaction client as
   * `tx` so the report is created atomically alongside the sample's own status
   * change; omit it to run standalone in a new transaction (e.g. from a script
   * or a future call site with no existing transaction).
   *
   * Resolves `labTestId` via the logical chain
   * `OrderItem.branchLabTestId -> BranchLabTest.sourceLabTestId`. Left `null`
   * when the order item has no branch lab test (a panel item, a direct/free-text
   * entry, or a branch-only test with no tenant `LabTest` source) — those
   * reports simply have no catalogue-driven content sections/reference ranges
   * to resolve against.
   */
  async ensureCreatedForAcceptedItem(
    tenantId: string,
    orderItemId: string,
    tx?: Prisma.TransactionClient,
    acceptedBy?: string | null,
  ): Promise<void> {
    if (tx) {
      await this.createReportForAcceptedItem(tx, tenantId, orderItemId, acceptedBy);
      return;
    }
    await this.prisma.withTenant(tenantId, (innerTx) =>
      this.createReportForAcceptedItem(innerTx, tenantId, orderItemId, acceptedBy),
    );
  }

  private async createReportForAcceptedItem(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderItemId: string,
    acceptedBy?: string | null,
  ): Promise<void> {
    const existing = await tx.labReport.findUnique({ where: { orderItemId } });
    if (existing) return;

    const orderItem = await tx.orderItem.findFirst({
      where: { id: orderItemId, tenantId, deletedAt: null },
      include: { branchLabTest: true },
    });
    if (!orderItem) return;

    const labTestId = orderItem.branchLabTest?.sourceLabTestId ?? null;

    const report = await tx.labReport.create({
      data: {
        tenantId,
        branchId: orderItem.branchId,
        orderItemId,
        labTestId,
        status: LabReportStatus.PENDING,
        isOutsourced: orderItem.outsourceCenterId !== null,
      },
    });
    await tx.labReportHistory.create({
      data: {
        tenantId,
        labReportId: report.id,
        toStatus: LabReportStatus.PENDING,
        action: 'sample_accepted',
        actorId: acceptedBy ?? orderItem.collectedBy ?? 'system',
      },
    });
  }

  // ── Worklist ────────────────────────────────────────────────────────────

  private requireBranch(branchId: string | null): string {
    if (!branchId) throw new ActiveBranchRequiredException();
    return branchId;
  }

  /**
   * Resolve the worklist's branch scope: an explicit `filters.branchId` ("All
   * Branches" filter row, LABORATORY.docx §3.1) overrides the caller's active
   * branch — same permissive pattern as `OrderService.findAll` (any branch in
   * the tenant, no ownership check). Falls back to the caller's active
   * branch, then errors if neither is present.
   */
  private resolveBranch(
    activeBranchId: string | null,
    filters: Pick<ListLabReportsDto, 'branchId'>,
  ): string {
    return this.requireBranch(filters.branchId ?? activeBranchId);
  }

  private buildListWhere(
    tenantId: string,
    branchId: string,
    filters: ListLabReportsDto,
  ): Prisma.LabReportWhereInput {
    const where: Prisma.LabReportWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
    };

    if (filters.status) where.status = filters.status;
    if (filters.urgent) where.isUrgent = true;
    if (filters.source === 'IN_HOUSE') where.isOutsourced = false;
    if (filters.source === 'OUTSOURCE') where.isOutsourced = true;
    // Standalone "Outsource" checkbox (distinct from the source pill above) —
    // same underlying signal, only ever narrows to outsourced items when checked.
    if (filters.outsource) where.isOutsourced = true;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
      };
    }

    const orderItem: Prisma.OrderItemWhereInput = {};
    if (filters.departmentId) {
      orderItem.branchLabTest = { departmentId: filters.departmentId };
    }
    if (filters.branchLabPanelId) {
      orderItem.branchLabPanelId = filters.branchLabPanelId;
    }
    if (filters.branchLabTestId) {
      orderItem.branchLabTestId = filters.branchLabTestId;
    }
    if (filters.sampleStatus) {
      orderItem.accessionSampleTests = {
        some: { sample: { status: filters.sampleStatus }, deletedAt: null },
      };
    }
    if (
      filters.referredByDoctorId ||
      filters.referralPanelId ||
      filters.homeCollection ||
      filters.patientId
    ) {
      const order: Prisma.OrderWhereInput = {};
      if (filters.referredByDoctorId) {
        order.referredByDoctorId = filters.referredByDoctorId;
      }
      if (filters.referralPanelId) {
        order.referralPanelId = filters.referralPanelId;
      }
      if (filters.homeCollection) {
        order.diagnostics = { is: { isHomeVisit: true } };
      }
      if (filters.patientId) {
        order.patientId = filters.patientId;
      }
      orderItem.order = order;
    }

    // Search bar (LABORATORY.docx §1.1 element 4): Patient Name, Order ID, Test
    // Name, Ref Panel. Spans both OrderItem-level fields (Test Name, via the
    // branch lab test/panel snapshot) and Order-level fields (Order ID, Patient
    // Name, Ref Panel) — combined as a top-level OR so a hit on any one field
    // matches, independent of the other orderItem/order filters above (which
    // still apply as an AND alongside this, via Prisma's implicit top-level AND).
    if (filters.search) {
      const search = filters.search;
      orderItem.OR = [
        { branchLabTest: { is: { testName: { contains: search, mode: 'insensitive' } } } },
        { branchLabPanel: { is: { panelName: { contains: search, mode: 'insensitive' } } } },
        {
          order: {
            is: {
              OR: [
                { orderCode: { contains: search, mode: 'insensitive' } },
                {
                  patient: {
                    OR: [
                      { firstName: { contains: search, mode: 'insensitive' } },
                      { lastName: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
                {
                  referralPanel: {
                    is: { name: { contains: search, mode: 'insensitive' } },
                  },
                },
              ],
            },
          },
        },
      ];
    }
    if (Object.keys(orderItem).length > 0) where.orderItem = orderItem;

    // Source pill (ALL/IN_HOUSE/OUTSOURCE) is wired above via LabReport.isOutsourced.
    // Home Collection is wired above via OrderDiagnostics.isHomeVisit (a
    // booking-level flag on the whole Order, joined through OrderItem.order).
    // TAT alert pills are explicitly out of scope per LABORATORY.docx.
    return where;
  }

  async findAll(
    tenantId: string,
    branchId: string | null,
    filters: ListLabReportsDto,
  ) {
    const resolvedBranchId = this.resolveBranch(branchId, filters);
    const where = this.buildListWhere(tenantId, resolvedBranchId, filters);
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 25;

    const [rows, total] = await Promise.all([
      this.prisma.labReport.findMany({
        where,
        include: LAB_REPORT_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.labReport.count({ where }),
    ]);

    let worklistRows = rows.map(toWorklistRow);
    worklistRows = await this.attachBranchNames(tenantId, worklistRows);
    worklistRows = await this.attachDepartmentNames(tenantId, worklistRows);
    worklistRows = await this.attachResultTypes(worklistRows);
    worklistRows = await this.attachSampleStatuses(tenantId, worklistRows);

    // `data` (not `rows`) — ResponseInterceptor.isPaginated() only lifts
    // total/page/limit into the envelope's `meta` block when the array field
    // is literally named `data` (every other paginated list endpoint in this
    // codebase already follows this; this one didn't, so `GET /lab-reports`
    // was returning a non-standard envelope with no `meta.total/page/limit`).
    return { data: worklistRows, total, page, limit };
  }

  /**
   * Resolves the Branch column (LABORATORY.docx §1.2) with one batched lookup
   * per page instead of a per-row query. `branchId` is a logical ref (no
   * Prisma relation — `Branch` has none anywhere in this codebase today), so
   * this mirrors `getOptions`'s existing plain-lookup pattern rather than
   * adding the schema's first real Branch relation.
   */
  private async attachBranchNames(
    tenantId: string,
    rows: LabReportWorklistRow[],
  ): Promise<LabReportWorklistRow[]> {
    const branchIds = [...new Set(rows.map((r) => r.branchId).filter((id): id is string => id !== null))];
    if (branchIds.length === 0) return rows;

    const branches = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const nameById = new Map(branches.map((b) => [b.id, b.name]));

    return rows.map((row) => ({
      ...row,
      branch: row.branchId && nameById.has(row.branchId)
        ? { id: row.branchId, name: nameById.get(row.branchId)! }
        : null,
    }));
  }

  /**
   * Resolves the Department column (LABORATORY.docx §1.2) the same way as
   * `attachBranchNames` — one batched lookup per page. `BranchLabTest.
   * departmentId`/`BranchLabPanel.departmentId` are logical refs (nullable,
   * no Prisma relation) — no different from `branchId`'s treatment above.
   * Replaces the frontend's prior string-matching-on-test-name workaround.
   */
  private async attachDepartmentNames(
    tenantId: string,
    rows: LabReportWorklistRow[],
  ): Promise<LabReportWorklistRow[]> {
    const departmentIds = [
      ...new Set(rows.map((r) => r.departmentId).filter((id): id is string => id !== null)),
    ];
    if (departmentIds.length === 0) return rows;

    const departments = await this.prisma.department.findMany({
      where: { id: { in: departmentIds }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const nameById = new Map(departments.map((d) => [d.id, d.name]));

    return rows.map((row) => ({
      ...row,
      department: row.departmentId && nameById.has(row.departmentId)
        ? { id: row.departmentId, name: nameById.get(row.departmentId)! }
        : null,
    }));
  }

  /**
   * Resolves the Test Name column's result-type suffix (LABORATORY.docx §1.2 —
   * "Urea — Quantitative", "HIV — Qualitative"). `ResultType` lives on
   * `LabTestResultParam`, one row per parameter of a `LabTest` — a
   * single-parameter test (Urea, HIV — the doc's own examples) has exactly one
   * unambiguous type, but a multi-parameter test (e.g. CBC: Hemoglobin/WBC/
   * Platelets, each with its own type) has no single well-defined type for the
   * test as a whole. Rather than guess one parameter's type, this only sets
   * `test.resultType` when the test has exactly one (non-deleted) param;
   * otherwise it's left null and the column shows the bare test name.
   * `labTestId` is a logical ref (no Prisma relation, per `resolveReferenceRange`
   * above), so this is a plain batched lookup, same shape as the Branch/
   * Department resolvers.
   */
  private async attachResultTypes(
    rows: LabReportWorklistRow[],
  ): Promise<LabReportWorklistRow[]> {
    const labTestIds = [
      ...new Set(rows.map((r) => r.labTestId).filter((id): id is string => id !== null)),
    ];
    if (labTestIds.length === 0) return rows;

    const params = await this.prisma.labTestResultParam.findMany({
      where: { labTestId: { in: labTestIds }, deletedAt: null },
      select: { labTestId: true, resultType: true },
    });

    const paramsByLabTest = new Map<string, (typeof params)[number][]>();
    for (const param of params) {
      const existing = paramsByLabTest.get(param.labTestId);
      if (existing) existing.push(param);
      else paramsByLabTest.set(param.labTestId, [param]);
    }

    return rows.map((row) => {
      if (!row.test || row.test.kind !== 'TEST' || !row.labTestId) return row;
      const testParams = paramsByLabTest.get(row.labTestId);
      const resultType =
        testParams && testParams.length === 1 ? testParams[0]!.resultType : null;
      return { ...row, test: { ...row.test, resultType } };
    });
  }

  /**
   * Resolves the real Accession sample-lifecycle status (and sample id, for
   * the Sample Overview action — ACCESSION.docx §A.10.4/§B.9's already-built
   * `GET /accession/samples/:id`, reused as-is rather than duplicated here)
   * for the worklist's Sample Status column — the client's requirement that
   * "the technician should be able to see all the statuses from both
   * modules" (view-only; this attaches no permission to change them —
   * enforcement is a separate, not-yet-built piece; see the module's own
   * tracking notes). An `OrderItem` can be linked to more than one
   * `AccessionSample` (a test needing both a blood tube and a urine cup —
   * see `AccessionSampleService.generateForOrderInTx`'s per-sample-type
   * grouping), so `sampleStatuses`/`sampleIds` are index-paired arrays (one
   * entry per distinct sample), not a single picked value — deduped on the
   * (sampleId, status) pair so two different samples sharing a status don't
   * silently drop one id. One batched query per page, same shape as the
   * other `attach*` resolvers above.
   */
  private async attachSampleStatuses(
    tenantId: string,
    rows: LabReportWorklistRow[],
  ): Promise<LabReportWorklistRow[]> {
    const orderItemIds = [...new Set(rows.map((r) => r.orderItemId))];
    if (orderItemIds.length === 0) return rows;

    const sampleTests = await this.prisma.accessionSampleTest.findMany({
      where: { orderItemId: { in: orderItemIds }, tenantId, deletedAt: null },
      select: { orderItemId: true, sample: { select: { id: true, status: true } } },
    });

    const samplesByOrderItem = new Map<string, Map<string, SampleStatus>>();
    for (const { orderItemId, sample } of sampleTests) {
      const bySampleId = samplesByOrderItem.get(orderItemId) ?? new Map<string, SampleStatus>();
      bySampleId.set(sample.id, sample.status);
      samplesByOrderItem.set(orderItemId, bySampleId);
    }

    return rows.map((row) => {
      const bySampleId = samplesByOrderItem.get(row.orderItemId);
      const entries = bySampleId ? [...bySampleId.entries()] : [];
      return {
        ...row,
        sampleIds: entries.map(([sampleId]) => sampleId),
        sampleStatuses: entries.map(([, status]) => status),
      };
    });
  }

  async getCounts(
    tenantId: string,
    branchId: string | null,
    filters: ListLabReportsDto,
  ): Promise<LabReportStatusCounts> {
    const resolvedBranchId = this.resolveBranch(branchId, filters);
    const baseWhere = this.buildListWhere(tenantId, resolvedBranchId, {
      ...filters,
      status: undefined,
    });

    const statuses = Object.values(LabReportStatus);
    const counts = await Promise.all(
      statuses.map((status) =>
        this.prisma.labReport.count({ where: { ...baseWhere, status } }),
      ),
    );
    const all = await this.prisma.labReport.count({ where: baseWhere });

    const byStatus = Object.fromEntries(
      statuses.map((s, i) => [s, counts[i]]),
    ) as Record<LabReportStatus, number>;

    return {
      all,
      pending: byStatus.PENDING,
      partialPending: byStatus.PARTIAL_PENDING,
      saved: byStatus.SAVED,
      validationPending: byStatus.VALIDATION_PENDING,
      resultDone: byStatus.RESULT_DONE,
      approved: byStatus.APPROVED,
      published: byStatus.PUBLISHED,
      errorReported: byStatus.ERROR_REPORTED,
      resultRejected: byStatus.RESULT_REJECTED,
    };
  }

  /**
   * Everything the Reporting Worklist's filter row needs in one call
   * (LABORATORY.docx §3.1) — real tenant/branch-scoped lookups for
   * Branches/Ref By/Panels/Departments/Lab Test/Lab Panel, plus the two
   * static lists (`sampleStatuses`/`reportStatuses`).
   */
  async getOptions(
    tenantId: string,
    branchId: string | null,
  ): Promise<LabReportOptions> {
    const activeBranchId = this.requireBranch(branchId);

    const [branches, referredByDoctors, referralPanels, departments, labTests, labPanels] =
      await Promise.all([
        this.prisma.branch.findMany({
          where: { tenantId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.referralDoctor.findMany({
          where: { tenantId, deletedAt: null },
          select: { id: true, firstName: true, lastName: true },
          orderBy: { firstName: 'asc' },
        }),
        this.prisma.referralPanel.findMany({
          where: { tenantId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.department.findMany({
          where: { tenantId, deletedAt: null },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.branchLabTest.findMany({
          where: {
            tenantId,
            branchId: activeBranchId,
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, testName: true },
          orderBy: { testName: 'asc' },
        }),
        this.prisma.branchLabPanel.findMany({
          where: {
            tenantId,
            branchId: activeBranchId,
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, panelName: true },
          orderBy: { panelName: 'asc' },
        }),
      ]);

    return {
      branches: branches.map((b) => ({ id: b.id, name: b.name })),
      referredByDoctors: referredByDoctors.map((d) => ({
        id: d.id,
        name: [d.firstName, d.lastName].filter(Boolean).join(' '),
      })),
      referralPanels: referralPanels.map((p) => ({ id: p.id, name: p.name })),
      departments: departments.map((d) => ({ id: d.id, name: d.name })),
      labTests: labTests.map((t) => ({ id: t.id, name: t.testName })),
      labPanels: labPanels.map((p) => ({ id: p.id, name: p.panelName })),
      sampleStatuses: Object.values(SampleStatus),
      reportStatuses: Object.values(LabReportStatus),
    };
  }

  /** Raw nested shape (`report.orderItem.order.patient`, etc.) — used
   * internally by callers that need the full Prisma relation tree, e.g.
   * `buildPrintContext`'s PDF variables. HTTP callers should use
   * `findByIdForApi` instead, which flattens this into the same flat
   * branch/order/patient shape the list endpoint returns. */
  async findById(
    id: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<LabReportDetailWithContent> {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
      include: LAB_REPORT_DETAIL_INCLUDE,
    });
    if (!report) throw new LabReportNotFoundException(id);

    const [contentSections, resultParams] = await Promise.all([
      this.getContentSections(tenantId, report.labTestId),
      this.getResultParams(report.labTestId),
    ]);
    return { ...report, contentSections, resultParams };
  }

  /**
   * Flattens `findById`'s raw nested tree into the same flat branch/
   * department/order/patient/referredByDoctor/referralPanel/test shape the
   * list endpoint (`findAll` -> `toWorklistRow` + attach* resolvers) already
   * returns, for `GET /lab-reports/:id`'s HTTP response. The frontend's
   * `ApiLabReportDetail` type expects these as flat top-level fields
   * (matching `ApiLabReportRow`), not nested three levels deep under
   * `orderItem.order.patient`. Without this, the endpoint silently returned
   * patient/order/branch/department/etc. as `undefined` (present nowhere in
   * the raw include tree at those flat key paths), so Report View's Patient
   * Details/Order ID/Reporting Date always rendered blank while
   * resultParams/contentSections (already flat, added explicitly in
   * `findById`) worked fine — the bug went unnoticed since no other
   * `useLabReport` consumer reads `.patient`/`.order` from this endpoint.
   */
  async findByIdForApi(
    id: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<LabReportDetailApiResponse> {
    const report = await this.findById(id, tenantId, branchId);

    let worklistRow = (await this.attachSampleStatuses(tenantId, [toWorklistRow(report)]))[0]!;
    worklistRow = (await this.attachBranchNames(tenantId, [worklistRow]))[0]!;
    worklistRow = (await this.attachDepartmentNames(tenantId, [worklistRow]))[0]!;
    worklistRow = (await this.attachResultTypes([worklistRow]))[0]!;

    return {
      ...worklistRow,
      resultValues: report.resultValues,
      notes: report.notes,
      attachments: report.attachments,
      multiStepProcess: report.multiStepProcess,
      contentSections: report.contentSections,
      resultParams: report.resultParams,
    };
  }

  /**
   * Resolve the Test Entry screen's read-only content sections
   * (LABORATORY.docx §4.5) from the tenant-level `LabTest` master.
   * `labTestId` is a logical ref (no Prisma relation) so this is a separate
   * lookup, not an `include`. All-null when there's no linked LabTest (a
   * panel item, a direct/free-text entry, or a branch-only test with no
   * tenant catalogue source).
   */
  private async getContentSections(
    tenantId: string,
    labTestId: string | null,
  ): Promise<LabReportContentSections> {
    const empty: LabReportContentSections = {
      usefulFor: null,
      interpretation: null,
      limitations: null,
      references: null,
    };
    if (!labTestId) return empty;

    // `LabTest.tenantId` is nullable (NULL for SITE_ADMIN global templates).
    // The id is already the specific tenant-owned row resolved from
    // BranchLabTest.sourceLabTestId at report-creation time, so match on id
    // alone rather than risk excluding it with an overly strict tenant filter.
    const labTest = await this.prisma.labTest.findFirst({
      where: { id: labTestId, deletedAt: null },
      select: {
        usefulFor: true,
        interpretationOfResults: true,
        limitations: true,
        references: true,
      },
    });
    if (!labTest) return empty;

    return {
      usefulFor: labTest.usefulFor,
      interpretation: labTest.interpretationOfResults,
      limitations: labTest.limitations,
      references: labTest.references,
    };
  }

  /**
   * Resolve the Test Entry screen's result-entry grid *row definitions*
   * (LABORATORY.docx §4.3) from `LabTestResultParam` — what parameters this
   * test has, independent of whether any value has been entered yet (a
   * brand-new `PENDING` report has zero `LabReportResultValue` rows, so the
   * grid can't be built from those alone). `labTestId` is a logical ref (no
   * Prisma relation), same treatment as `getContentSections`. Empty array
   * when there's no linked LabTest (panel/direct/branch-only test).
   */
  private async getResultParams(
    labTestId: string | null,
  ): Promise<LabReportResultParam[]> {
    if (!labTestId) return [];

    const params = await this.prisma.labTestResultParam.findMany({
      where: { labTestId, deletedAt: null },
      select: {
        id: true,
        parameterName: true,
        parameterCode: true,
        resultType: true,
        reportingUnit: true,
        method: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
    return params;
  }

  private async requireReport(
    id: string,
    tenantId: string,
    branchId: string,
  ) {
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(id);
    if (report.isLocked) throw new LabReportLockedException(id);
    return report;
  }

  private assertTransition(
    action: LabReportTransitionAction,
    currentStatus: LabReportStatus,
  ) {
    const allowed = LAB_REPORT_ALLOWED_FROM[action];
    if (!(allowed as readonly LabReportStatus[]).includes(currentStatus)) {
      throw new InvalidLabReportTransitionException(
        action,
        currentStatus,
        allowed,
      );
    }
  }

  private async recordHistory(
    tx: Prisma.TransactionClient,
    tenantId: string,
    labReportId: string,
    fromStatus: LabReportStatus | null,
    toStatus: LabReportStatus,
    action: string,
    actorId: string,
    notes?: string,
  ) {
    await tx.labReportHistory.create({
      data: {
        tenantId,
        labReportId,
        fromStatus,
        toStatus,
        action,
        notes,
        actorId,
      },
    });
  }

  // ── Test Entry: result values + reference-range resolution ────────────────

  async upsertResultValues(
    id: string,
    tenantId: string,
    branchId: string | null,
    dto: UpsertResultValuesDto,
    actorId: string,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    await this.requireReport(id, tenantId, activeBranchId);

    await this.prisma.withTenant(tenantId, async (tx) => {
      for (const value of dto.values) {
        await tx.labReportResultValue.upsert({
          where: {
            labReportId_resultParamId: {
              labReportId: id,
              resultParamId: value.resultParamId,
            },
          },
          create: {
            tenantId,
            labReportId: id,
            resultParamId: value.resultParamId,
            observed1: value.observed1,
            observed2: value.observed2,
            unit: value.unit,
            methodology: value.methodology,
            referenceRangeId: value.referenceRangeId,
            referenceDisplay: value.referenceDisplay,
            source: ResultValueSource.MANUAL,
            enteredAt: new Date(),
            enteredBy: actorId,
          },
          update: {
            observed1: value.observed1,
            observed2: value.observed2,
            unit: value.unit,
            methodology: value.methodology,
            referenceRangeId: value.referenceRangeId,
            referenceDisplay: value.referenceDisplay,
            source: ResultValueSource.MANUAL,
            enteredAt: new Date(),
            enteredBy: actorId,
          },
        });
      }
    });

    // findByIdForApi (flat shape), not findById (raw nested) — this is an
    // HTTP response (PATCH .../:id/results), same reasoning as
    // LabReportController.findOne's fix (TECHNICIAN-REPORTING-GAPS.md,
    // "Report View... stayed blank" entry). Currently the frontend's
    // useUpsertResultValues ignores this response entirely, so this was
    // dormant/harmless — fixed anyway so a future consumer doesn't inherit
    // the same silent-blank-fields bug.
    return this.findByIdForApi(id, tenantId, activeBranchId);
  }

  /**
   * Resolve the reference range/value for one result parameter given the
   * current methodology and the report's patient (age/gender), following
   * `LabTestResultParam.resultType` to decide which of
   * `LabTestReferenceRange`/`LabTestReferenceValue` to search. Backs the Test
   * Entry grid's "changing methodology swaps the reference range" behaviour
   * (LABORATORY.docx §4.3) — the frontend calls this, then re-submits the
   * result value with the resolved `referenceRangeId`/`referenceDisplay`.
   */
  async resolveReferenceRange(
    id: string,
    tenantId: string,
    branchId: string | null,
    query: ReferenceRangeQueryDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
      include: {
        orderItem: { include: { order: { include: { patient: true } } } },
      },
    });
    if (!report) throw new LabReportNotFoundException(id);
    if (!report.labTestId) throw new LabTestCatalogueMissingException(id);

    const param = await this.prisma.labTestResultParam.findFirst({
      where: {
        id: query.resultParamId,
        labTestId: report.labTestId,
        deletedAt: null,
      },
    });
    if (!param) throw new LabTestCatalogueMissingException(id);

    const patient = report.orderItem.order.patient;
    const ageInDays = patient.age
      ? patientAgeInDays(patient.age, patient.ageType ?? 'YEARS')
      : null;

    if (param.resultType === 'QUALITATIVE') {
      const candidates = await this.prisma.labTestReferenceValue.findMany({
        where: {
          paramId: param.id,
          deletedAt: null,
          ...(query.methodology ? { method: query.methodology } : {}),
        },
      });
      const match = candidates.find(
        (c) =>
          genderMatches(c.gender, patient.gender) &&
          (ageInDays === null ||
            (ageInDays >= rangeAgeInDays(c.ageFrom, c.ageFromUnit) &&
              ageInDays <= rangeAgeInDays(c.ageTo, c.ageToUnit))),
      );
      return match
        ? {
            referenceRangeId: match.id,
            referenceDisplay:
              match.displayOfReferenceRange ?? match.normalValueText,
          }
        : { referenceRangeId: null, referenceDisplay: null };
    }

    const candidates = await this.prisma.labTestReferenceRange.findMany({
      where: {
        paramId: param.id,
        deletedAt: null,
        ...(query.methodology ? { method: query.methodology } : {}),
      },
    });
    const match = candidates.find(
      (c) =>
        genderMatches(c.gender, patient.gender) &&
        (ageInDays === null ||
          (ageInDays >= rangeAgeInDays(c.ageFrom, c.ageFromUnit) &&
            ageInDays <= rangeAgeInDays(c.ageTo, c.ageToUnit))),
    );
    return match
      ? {
          referenceRangeId: match.id,
          referenceDisplay:
            match.displayOfReferenceRange ??
            `${match.lowerLimit ?? ''} - ${match.upperLimit ?? ''}`.trim(),
        }
      : { referenceRangeId: null, referenceDisplay: null };
  }

  /**
   * Trend Report (LABORATORY.docx §5.10) — this patient's full history of
   * observed values for one result parameter, oldest first. The doc says this
   * "already exists in Analytics, reuse the existing component/endpoint" —
   * no such module exists anywhere in this codebase (confirmed: no
   * AnalyticsModule, no trend endpoint, `DashboardModule` is unrelated
   * business-summary widgets), so this is built fresh, extending
   * `DeltaCheckService.findPreviousResultValue`'s same patient+parameter
   * lookup shape (that method only needs the single most recent prior value;
   * this needs the full series, oldest to newest, including the current
   * report's own value so "now" shows in context).
   *
   * Date + Value, plus a narrow, quantitative-only Normal/High/Low `flag` on
   * `observed1` (the primary value; `observed2` is returned unflagged, as
   * secondary context only). This is NOT the deferred system-wide
   * range-classification feature (see `TECHNICIAN-REPORTING-GAPS.md` — Critical
   * Alert/Out of Range are still 100% manual, no automatic triggering anywhere).
   * It's deliberately smaller: a read-only display flag for this one chart,
   * computed by joining each value's already-resolved `referenceRangeId` back
   * to its numeric `lowerLimit`/`upperLimit` (no re-run of `resolveReferenceRange`'s
   * age/gender/methodology matching — that already happened once, at entry
   * time). No critical tier (`criticalMin`/`criticalMax` unused) — v1 is
   * intentionally just Normal/High/Low, by product decision. `flag` is `null`,
   * never guessed, whenever there's no matched range or `observed1` isn't a
   * finite number (qualitative results always fall into this case, since they
   * resolve through `LabTestReferenceValue`, which has no numeric bounds at all).
   */
  async findTrend(
    id: string,
    tenantId: string,
    branchId: string | null,
    query: TrendReportQueryDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
      include: { orderItem: { include: { order: true } } },
    });
    if (!report) throw new LabReportNotFoundException(id);

    const values = await this.prisma.labReportResultValue.findMany({
      where: {
        tenantId,
        resultParamId: query.resultParamId,
        deletedAt: null,
        labReport: {
          orderItem: { order: { patientId: report.orderItem.order.patientId } },
        },
      },
      orderBy: { enteredAt: 'asc' },
    });

    const rangeIds = [
      ...new Set(
        values
          .map((v) => v.referenceRangeId)
          .filter((rid): rid is string => rid != null),
      ),
    ];
    const ranges =
      rangeIds.length === 0
        ? []
        : await this.prisma.labTestReferenceRange.findMany({
            where: { id: { in: rangeIds } },
            select: { id: true, lowerLimit: true, upperLimit: true },
          });
    const rangeById = new Map(ranges.map((r) => [r.id, r]));

    return values.map((v) => {
      const range = v.referenceRangeId
        ? rangeById.get(v.referenceRangeId)
        : undefined;
      const flag = computeTrendFlag(v.observed1, range);
      return {
        labReportId: v.labReportId,
        date: v.enteredAt,
        observed1: v.observed1,
        observed2: v.observed2,
        unit: v.unit,
        referenceDisplay: v.referenceDisplay,
        flag,
      };
    });
  }

  // ── Print / Download Report ─────────────────────────────────────────────────

  /**
   * Builds the render context for Print/Download (LABORATORY.docx §5, §6 —
   * appears on 7 of the 9 report statuses). Bridges `LabReport`'s real data
   * into the shape `PdfReportTemplateService.generatePdf` already expects
   * (`variables`/`sections`/`signatories`) — the PDF engine itself
   * (Puppeteer-based, template CRUD, token resolver) already exists and
   * works, per `GeneratePdfDto`'s own doc comment ("Decoupled from the
   * lab-result models (not yet wired)"); this is that missing wiring.
   *
   * Matches ACCESSION.docx §A.14's explicit module boundary ("report
   * creation and dispatch are in the Finance/Reports module") — no separate
   * Finance/Reports module exists under that name, but `PdfReportTemplateModule`
   * is that module in substance (default template `type` is literally
   * `'lab_report'`), so this reuses it rather than building a second PDF
   * pipeline inside Technician Reporting.
   */
  async buildPrintContext(
    id: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<GeneratePdfDto> {
    const report = await this.findById(id, tenantId, branchId);
    const order = report.orderItem.order;
    const patient = order.patient;
    const testOrPanel = report.orderItem.branchLabTest ?? report.orderItem.branchLabPanel;

    let signatories: SigningAuthorityDto[] = [];
    if (report.approvedBy) {
      const signatory = await this.prisma.person.findFirst({
        where: { id: report.approvedBy, deletedAt: null },
        select: { firstName: true, middleName: true, lastName: true, designation: true },
      });
      if (signatory) {
        signatories = [
          {
            name: [signatory.firstName, signatory.middleName, signatory.lastName]
              .filter(Boolean)
              .join(' '),
            designation: signatory.designation ?? undefined,
          },
        ];
      }
    }

    const results = report.resultValues.map((v) => ({
      observed1: v.observed1 ?? '',
      observed2: v.observed2 ?? '',
      unit: v.unit ?? '',
      methodology: v.methodology ?? '',
      reference_display: v.referenceDisplay ?? '',
    }));

    return {
      variables: {
        order_code: order.orderCode,
        order_date: order.orderDate.toISOString().slice(0, 10),
        patient_name: [patient.firstName, patient.middleName, patient.lastName]
          .filter(Boolean)
          .join(' '),
        patient_age: patient.age ?? '',
        patient_gender: patient.gender ?? '',
        patient_um_id: patient.umId ?? '',
        referred_by: order.referredByDoctor
          ? [order.referredByDoctor.firstName, order.referredByDoctor.lastName]
              .filter(Boolean)
              .join(' ')
          : '',
        referral_panel: order.referralPanel?.name ?? '',
        test_name:
          (testOrPanel && 'testName' in testOrPanel ? testOrPanel.testName : undefined) ??
          (testOrPanel && 'panelName' in testOrPanel ? testOrPanel.panelName : undefined) ??
          report.orderItem.direct ??
          '',
        report_status: report.status,
        useful_for: report.contentSections.usefulFor ?? '',
        interpretation: report.contentSections.interpretation ?? '',
        limitations: report.contentSections.limitations ?? '',
        references: report.contentSections.references ?? '',
      },
      sections: { results },
      signatories,
    };
  }

  /**
   * Print/Download a report (LABORATORY.docx §6.10's "Print / Download"
   * action). Resolves the tenant's active `lab_report` template (or the
   * caller's explicit `templateId`) and renders it with this report's real
   * data via `PdfReportTemplateService.generatePdf`.
   * @throws NoActivePrintTemplateException if no active template exists
   * @throws AmbiguousPrintTemplateException if multiple exist and no
   * `templateId` was given
   */
  async print(
    id: string,
    tenantId: string,
    branchId: string | null,
    templateId?: string,
  ): Promise<Buffer> {
    const context = await this.buildPrintContext(id, tenantId, branchId);
    const resolvedTemplateId =
      templateId ?? (await this.resolvePrintTemplateId(tenantId));
    return this.pdfReportTemplateService.generatePdf(resolvedTemplateId, tenantId, context);
  }

  private async resolvePrintTemplateId(tenantId: string): Promise<string> {
    const { data } = await this.pdfReportTemplateService.findAllForTenant(tenantId, 1, 10, {
      type: 'lab_report',
      status: 'ACTIVE',
    });
    if (data.length === 0) throw new NoActivePrintTemplateException(tenantId);
    if (data.length > 1) {
      throw new AmbiguousPrintTemplateException(
        tenantId,
        data.map((t) => t.id),
      );
    }
    return data[0]!.id;
  }

  // ── Save / Submit ──────────────────────────────────────────────────────────

  async save(id: string, tenantId: string, branchId: string | null, actorId: string) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('save', report.status);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: {
          status: LabReportStatus.SAVED,
          savedAt: new Date(),
          savedBy: actorId,
        },
      });
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.SAVED,
        'save',
        actorId,
      );
      return updated;
    });
  }

  async submit(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('submit', report.status);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: {
          status: LabReportStatus.VALIDATION_PENDING,
          submittedAt: new Date(),
          submittedBy: actorId,
        },
      });
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.VALIDATION_PENDING,
        'submit',
        actorId,
      );
      return updated;
    });
  }

  // ── Validate / Edit / Reject / Resubmit ────────────────────────────────────

  async validate(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    notes?: string,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('validate', report.status);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: {
          status: LabReportStatus.RESULT_DONE,
          validatedAt: new Date(),
          validatedBy: actorId,
        },
      });
      if (notes) {
        await tx.labReportNote.create({
          data: { tenantId, labReportId: id, category: 'TECH', body: notes, createdBy: actorId },
        });
      }
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.RESULT_DONE,
        'validate',
        actorId,
        notes,
      );
      return updated;
    });
  }

  /** Validation Pending | Result Done | Approved -> Saved (send back for correction). */
  async editReport(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('editReport', report.status);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: { status: LabReportStatus.SAVED },
      });
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.SAVED,
        'edit_report',
        actorId,
      );
      return updated;
    });
  }

  async reject(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    notes: string,
  ) {
    if (!notes) throw new LabReportNotesRequiredException('reject this report');
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('reject', report.status);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: { status: LabReportStatus.RESULT_REJECTED },
      });
      await tx.labReportNote.create({
        data: {
          tenantId,
          labReportId: id,
          category: 'RESULT_REJECTED',
          body: notes,
          createdBy: actorId,
        },
      });
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.RESULT_REJECTED,
        'reject',
        actorId,
        notes,
      );
      return updated;
    });
  }

  /** Result Rejected | Error Reported -> Validation Pending, after edit/correct. */
  async resubmit(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('resubmit', report.status);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: {
          status: LabReportStatus.VALIDATION_PENDING,
          submittedAt: new Date(),
          submittedBy: actorId,
        },
      });
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.VALIDATION_PENDING,
        'resubmit',
        actorId,
      );
      return updated;
    });
  }

  // ── Approve / Publish / Error Reported ─────────────────────────────────────

  async approve(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('approve', report.status);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: {
          status: LabReportStatus.APPROVED,
          approvedAt: new Date(),
          approvedBy: actorId,
        },
      });
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.APPROVED,
        'approve',
        actorId,
      );
      return updated;
    });
  }

  async publish(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('publish', report.status);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: {
          status: LabReportStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedBy: actorId,
        },
      });
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.PUBLISHED,
        'publish',
        actorId,
      );
      return updated;
    });
  }

  async errorReported(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    notes: string,
  ) {
    if (!notes) {
      throw new LabReportNotesRequiredException('flag this report as errored');
    }
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('errorReported', report.status);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: { status: LabReportStatus.ERROR_REPORTED },
      });
      await tx.labReportNote.create({
        data: {
          tenantId,
          labReportId: id,
          category: 'ERROR_REPORTED',
          body: notes,
          createdBy: actorId,
        },
      });
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.ERROR_REPORTED,
        'error_reported',
        actorId,
        notes,
      );
      return updated;
    });
  }

  // ── Re-Run (any status -> Pending, clears result values) ───────────────────

  /**
   * Clears all `LabReportResultValue` rows and returns the report to PENDING,
   * from ANY status (LABORATORY.docx §2.2 "Any status" row) — no
   * `assertTransition` gate applies here. Creating the `ReRunRequest` worklist
   * row is the caller's (worklist service's) responsibility; this method only
   * performs the report-side reset.
   */
  async resetForRerun(
    id: string,
    tenantId: string,
    branchId: string,
    actorId: string,
  ) {
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(id);

    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.labReportResultValue.updateMany({
        where: { labReportId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      const updated = await tx.labReport.update({
        where: { id },
        data: {
          status: LabReportStatus.PENDING,
          savedAt: null,
          savedBy: null,
          submittedAt: null,
          submittedBy: null,
          validatedAt: null,
          validatedBy: null,
          approvedAt: null,
          approvedBy: null,
          publishedAt: null,
          publishedBy: null,
        },
      });
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.PENDING,
        're_run',
        actorId,
      );
      return updated;
    });
  }

  // ── Lock / Unlock ───────────────────────────────────────────────────────────

  async lock(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    notes?: string,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(id);

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: {
          isLocked: true,
          lockedAt: new Date(),
          lockedBy: actorId,
          lockNotes: notes,
        },
      });
      if (notes) {
        await tx.labReportNote.create({
          data: { tenantId, labReportId: id, category: 'LOCK', body: notes, createdBy: actorId },
        });
      }
      return updated;
    });
  }

  /**
   * Unlock requires the caller to hold the `lab_operations:lock_override`
   * permission (supervisor-gated) — checked in the controller via
   * `usePermissions`-equivalent guard, NOT here. This method assumes the
   * caller has already been authorized (see the `canUnlock` param and the
   * TODO on the controller route).
   */
  async unlock(
    id: string,
    tenantId: string,
    branchId: string | null,
    canUnlock: boolean,
  ) {
    if (!canUnlock) throw new UnlockNotPermittedException();
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(id);

    return this.prisma.labReport.update({
      where: { id },
      data: { isLocked: false, lockedAt: null, lockedBy: null, lockNotes: null },
    });
  }

  // ── Update Status (generic cross-technician note) ──────────────────────────

  async updateStatus(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    notes: string,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    await this.requireReport(id, tenantId, activeBranchId);

    return this.prisma.labReportNote.create({
      data: {
        tenantId,
        labReportId: id,
        category: 'UPDATE_STATUS',
        body: notes,
        createdBy: actorId,
      },
    });
  }

  // ── Notes & Documents tabs (LABORATORY.docx §4.2) ──────────────────────────
  // Order Notes / Sample Notes / Tech Notes — plain notes visible to every
  // technician who opens the order. "Documents" (the 4th tab) is the
  // attachments feature, a separate, not-yet-built piece (no `/attachments`
  // endpoint exists anywhere in this module today) — not covered here.

  async createNote(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    dto: CreateLabReportNoteDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    await this.requireReport(id, tenantId, activeBranchId);

    return this.prisma.labReportNote.create({
      data: {
        tenantId,
        labReportId: id,
        category: dto.category,
        body: dto.body,
        createdBy: actorId,
      },
    });
  }

  async findNotes(
    id: string,
    tenantId: string,
    branchId: string | null,
    query: ListLabReportNotesDto,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    await this.requireReport(id, tenantId, activeBranchId);

    return this.prisma.labReportNote.findMany({
      where: {
        tenantId,
        labReportId: id,
        category: query.category ? query.category : { in: [...PLAIN_NOTE_CATEGORIES] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Audit trail ─────────────────────────────────────────────────────────────

  async getHistory(id: string, tenantId: string, branchId: string | null) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(id);

    const rows = await this.prisma.labReportHistory.findMany({
      where: { labReportId: id, tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return this.enrichActorNames(rows);
  }

  /**
   * Attach each actor's human name to history rows. `actorId` is a logical
   * reference to `Person.id` (no Prisma relation — same deliberate pattern as
   * `AuditLog.actorPersonId` in AuditService: an audit trail must survive
   * independent of the referenced person, so it stays unenforced rather than
   * risking a cascade/restrict on Person changes). Person is soft-deleted only
   * (never hard-deleted), so a missing lookup here would indicate bad data,
   * not routine deletion — falls back to `null`, never guessed.
   */
  private async enrichActorNames(
    rows: LabReportHistory[],
  ): Promise<Array<LabReportHistory & { actorName: string | null }>> {
    const actorIds = [...new Set(rows.map((r) => r.actorId))];
    if (actorIds.length === 0) {
      return rows.map((r) => ({ ...r, actorName: null }));
    }

    const persons = await this.prisma.person.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, middleName: true, lastName: true },
    });
    const nameById = new Map(
      persons.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' '),
      ]),
    );

    return rows.map((r) => ({
      ...r,
      actorName: nameById.get(r.actorId) ?? null,
    }));
  }
}
