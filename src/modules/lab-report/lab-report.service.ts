import { Injectable } from '@nestjs/common';
import { LabReportStatus, Prisma, ResultValueSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListLabReportsDto } from './dto/list-lab-reports.dto';
import { UpsertResultValuesDto } from './dto/upsert-result-values.dto';
import { ReferenceRangeQueryDto } from './dto/reference-range-query.dto';
import {
  LAB_REPORT_ALLOWED_FROM,
  LAB_REPORT_DETAIL_INCLUDE,
  LAB_REPORT_LIST_INCLUDE,
  LabReportContentSections,
  LabReportDetailWithContent,
  LabReportStatusCounts,
  LabReportTransitionAction,
} from './entities/lab-report.entity';
import {
  LabReportOptions,
  SAMPLE_STATUS_OPTIONS,
} from './entities/lab-report-options.entity';
import {
  ActiveBranchRequiredException,
  InvalidLabReportTransitionException,
  LabReportLockedException,
  LabReportNotesRequiredException,
  LabReportNotFoundException,
  LabTestCatalogueMissingException,
  UnlockNotPermittedException,
} from './exceptions/lab-report.exceptions';
import {
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
  constructor(private readonly prisma: PrismaService) {}

  // ── Creation (triggered by Accession's sample-accept signal) ──────────────

  /**
   * Create a `LabReport` for an order item once its sample is accepted, if one
   * doesn't already exist (idempotent). Interim trigger: called from
   * `OrderService.collectItem` right after `OrderItem.collectedAt` is set,
   * since Accession's own New/Collected/Accepted state machine doesn't exist
   * yet. When it ships, only the call site changes — not this method or the
   * `LabReport` schema.
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
  ): Promise<void> {
    const existing = await this.prisma.labReport.findUnique({
      where: { orderItemId },
    });
    if (existing) return;

    const orderItem = await this.prisma.orderItem.findFirst({
      where: { id: orderItemId, tenantId, deletedAt: null },
      include: { branchLabTest: true },
    });
    if (!orderItem) return;

    const labTestId = orderItem.branchLabTest?.sourceLabTestId ?? null;

    await this.prisma.withTenant(tenantId, async (tx) => {
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
          actorId: orderItem.collectedBy ?? 'system',
        },
      });
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
    if (filters.sampleStatus === 'NOT_COLLECTED') {
      orderItem.collectedAt = null;
    }
    if (filters.sampleStatus === 'COLLECTED') {
      orderItem.collectedAt = { not: null };
    }
    if (filters.referredByDoctorId || filters.referralPanelId || filters.homeCollection) {
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

    return { rows, total, page, limit };
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
      sampleStatuses: [...SAMPLE_STATUS_OPTIONS],
      reportStatuses: Object.values(LabReportStatus),
    };
  }

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

    const contentSections = await this.getContentSections(
      tenantId,
      report.labTestId,
    );
    return { ...report, contentSections };
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

    return this.findById(id, tenantId, activeBranchId);
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

  /** Validation Pending | Result Done -> Saved (send back for correction). */
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

  // ── Audit trail ─────────────────────────────────────────────────────────────

  async getHistory(id: string, tenantId: string, branchId: string | null) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(id);

    return this.prisma.labReportHistory.findMany({
      where: { labReportId: id, tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
