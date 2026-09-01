import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  LabReportHistory,
  LabReportStatus,
  MessagingChannel,
  PersonMappingType,
  Prisma,
  RecipientType,
  ResultValueSource,
  SampleStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ShareService,
  type ShareRecipient,
} from '../communication/services/share.service';
import {
  ShareOrderReportDto,
  ShareAllOrderReportDto,
  ShareAllResult,
  ShareChannelResult,
  ShareInfo,
} from './dto/share-order-report.dto';
import { ListLabReportsDto } from './dto/list-lab-reports.dto';
import { UpsertResultValuesDto } from './dto/upsert-result-values.dto';
import { ReferenceRangeQueryDto } from './dto/reference-range-query.dto';
import { ReferenceRangeMethodsQueryDto } from './dto/reference-range-methods-query.dto';
import { TrendReportQueryDto } from './dto/trend-report-query.dto';
import {
  CreateLabReportNoteDto,
  ListLabReportNotesDto,
  PLAIN_NOTE_CATEGORIES,
} from './dto/lab-report-note.dto';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import type { PdfReportTemplateType } from '../pdf-report-template/constants/pdf-report-template-types.constant';
import { TechnicianSettingsService } from '../technician-settings/technician-settings.service';
import { LabTestService } from '../lab-test/lab-test.service';
import { UpdateContentSectionsDto } from './dto/update-content-sections.dto';
import {
  GeneratePdfDto,
  SigningAuthorityDto,
} from '../pdf-report-template/dto/generate-pdf.dto';
import {
  LAB_REPORT_ALLOWED_FROM,
  LAB_REPORT_DETAIL_INCLUDE,
  LAB_REPORT_LIST_INCLUDE,
  LabReportContentSections,
  LabReportDetailApiResponse,
  LabReportDetailWithContent,
  LabReportResultParam,
  LabReportSignatoryCandidate,
  LabReportSignatoryCandidatesResponse,
  LabReportStatusCounts,
  LabReportTransitionAction,
  LabReportWorklistRow,
  fullName,
  toWorklistRow,
} from './entities/lab-report.entity';
import { LabReportOptions } from './entities/lab-report-options.entity';
import { resolveActorNames } from './entities/worklist.entity';
import { ApproveReportDto } from './dto/approve-report.dto';
import {
  ActiveBranchRequiredException,
  InvalidLabReportTransitionException,
  InvalidSignatoryAuthorityException,
  LabReportLockedException,
  LabReportSampleMissingException,
  LabReportResultsRequiredException,
  LabReportNotesRequiredException,
  LabReportNotFoundException,
  LabTestCatalogueMissingException,
  UnlockNotPermittedException,
  NoActivePrintTemplateException,
  AmbiguousPrintTemplateException,
  OrderReportsNotFoundException,
  ReportingWindowClosedException,
} from './exceptions/lab-report.exceptions';
import {
  computeTrendFlag,
  genderMatches,
  patientAgeInDays,
  rangeAgeInDays,
} from './utils/reference-range.util';
import { TatService } from './tat.service';

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
    private readonly tatService: TatService,
    private readonly technicianSettingsService: TechnicianSettingsService,
    private readonly labTestService: LabTestService,
    private readonly eventEmitter: EventEmitter2,
    private readonly shareService: ShareService,
  ) {}

  private readonly logger = new Logger(LabReportService.name);

  /** The messaging feature key the Order Console "Share" flow resolves templates by. */
  private static readonly SHARE_FEATURE = 'console_lab_report_as_attachment';

  // ── Creation (triggered by Accession's sample-accept signal) ──────────────

  /**
   * Create a `LabReport` for an order item once its sample is accepted, if one
   * doesn't already exist (idempotent). Real trigger: called from
   * `OrderSampleService` when a sample transitions to `ACCEPTED`, once per
   * `OrderItem` linked to that sample (via `OrderSampleTest` — one sample
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
      await this.createReportForAcceptedItem(
        tx,
        tenantId,
        orderItemId,
        acceptedBy,
      );
      return;
    }
    await this.prisma.withTenant(tenantId, (innerTx) =>
      this.createReportForAcceptedItem(
        innerTx,
        tenantId,
        orderItemId,
        acceptedBy,
      ),
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
    if (filters.orderId) {
      orderItem.orderId = filters.orderId;
    }
    if (filters.sampleStatus) {
      orderItem.orderSampleTests = {
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
      // Bug fix: a full-name search (e.g. "Hiroshi Tanaka") never matched
      // anything, because firstName/lastName were only ever checked against
      // the whole search string independently — neither field alone
      // contains a two-word string. Splitting on whitespace and requiring
      // every word to be found somewhere across first/middle/last name (in
      // any order) fixes full-name search without changing single-word
      // search behavior at all (a 1-word split is just the original check).
      const searchWords = search.trim().split(/\s+/).filter(Boolean);
      const patientNameMatchesEveryWord: Prisma.PatientWhereInput = {
        AND: searchWords.map((word) => ({
          OR: [
            { firstName: { contains: word, mode: 'insensitive' as const } },
            { middleName: { contains: word, mode: 'insensitive' as const } },
            { lastName: { contains: word, mode: 'insensitive' as const } },
          ],
        })),
      };
      orderItem.OR = [
        {
          branchLabTest: {
            is: { testName: { contains: search, mode: 'insensitive' } },
          },
        },
        {
          branchLabPanel: {
            is: { panelName: { contains: search, mode: 'insensitive' } },
          },
        },
        {
          order: {
            is: {
              OR: [
                { orderCode: { contains: search, mode: 'insensitive' } },
                { patient: patientNameMatchesEveryWord },
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
        // Default sort matches Registration Billing / Accession worklists:
        // by when the ORDER was placed, not when this LabReport row itself
        // was created (which is stamped later, at sample-ACCEPTED time, and
        // drifts out of order when samples are accepted out of sequence).
        orderBy: { orderItem: { order: { createdAt: 'desc' } } },
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

    // Analytical-TAT band per row (SRS §6.2/§8): frozen snapshot for approved
    // reports, live compute for in-flight ones — batched over the whole page.
    const tatByReport = await this.tatService.computeBandsForReports(
      tenantId,
      resolvedBranchId,
      rows,
    );
    worklistRows = worklistRows.map((r) => ({
      ...r,
      tat: tatByReport.get(r.id) ?? null,
    }));
    worklistRows = await this.attachMultiStepProcess(worklistRows);

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
    const branchIds = [
      ...new Set(
        rows.map((r) => r.branchId).filter((id): id is string => id !== null),
      ),
    ];
    if (branchIds.length === 0) return rows;

    const branches = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const nameById = new Map(branches.map((b) => [b.id, b.name]));

    return rows.map((row) => ({
      ...row,
      branch:
        row.branchId && nameById.has(row.branchId)
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
      ...new Set(
        rows
          .map((r) => r.departmentId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (departmentIds.length === 0) return rows;

    const departments = await this.prisma.department.findMany({
      where: { id: { in: departmentIds }, tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const nameById = new Map(departments.map((d) => [d.id, d.name]));

    return rows.map((row) => ({
      ...row,
      department:
        row.departmentId && nameById.has(row.departmentId)
          ? { id: row.departmentId, name: nameById.get(row.departmentId)! }
          : null,
    }));
  }

  /**
   * Resolves this report's department/category/sub-category the same way
   * `toWorklistRow` resolves department
   * (`branchLabTest?.departmentId ?? branchLabPanel?.departmentId ?? null`),
   * generalized to all three classification axes, without needing the
   * report's full detail payload — used by `getSignatoryCandidatesInternal`.
   * `BranchLabPanel` has no `subCategoryId` column at all (only `LabTest`/
   * `BranchLabTest` classify that granularly), so a panel-based report's
   * `subCategoryId` is always null — a report on a panel item simply has no
   * sub-category-basis signatories, regardless of configuration.
   */
  private async resolveReportClassificationIds(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<{
    departmentId: string | null;
    categoryId: string | null;
    subCategoryId: string | null;
    report: { branchId: string | null };
  }> {
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
      select: {
        branchId: true,
        orderItem: {
          select: {
            branchLabTest: {
              select: {
                departmentId: true,
                categoryId: true,
                subCategoryId: true,
              },
            },
            branchLabPanel: {
              select: { departmentId: true, categoryId: true },
            },
          },
        },
      },
    });
    if (!report) throw new LabReportNotFoundException(id);
    return {
      departmentId:
        report.orderItem.branchLabTest?.departmentId ??
        report.orderItem.branchLabPanel?.departmentId ??
        null,
      categoryId:
        report.orderItem.branchLabTest?.categoryId ??
        report.orderItem.branchLabPanel?.categoryId ??
        null,
      subCategoryId: report.orderItem.branchLabTest?.subCategoryId ?? null,
      report: { branchId: report.branchId },
    };
  }

  /**
   * Resolves the up-to-3 signatory candidates for a report's Approve modal
   * (LABORATORY.docx "Signatory Authority Selection - Approval Pop-up
   * Logic"). Which classification axis governs the lookup — Department,
   * Category, or Sub-Category — is driven by the branch's
   * `TechnicianSetting.signatoryBasis` ("Signatory Depends Based On" in
   * Technician Settings → Laboratory Permissions); this resolves the report's
   * id for that axis (via `resolveReportClassificationIds`) and queries the
   * matching person-mapping table (`DepartmentPersonMapping` /
   * `CategoryPersonMapping` / `SubCategoryPersonMapping` — field-for-field
   * identical for this purpose: `personId`, `type`, `branchId`,
   * `isSignatory`, `priority`), filtered to `isSignatory: true`, scoped to
   * this report's branch or tenant-wide (`branchId: null`), excluding
   * `EXTERNAL_REFERRAL` (a referral source signing a lab report doesn't fit
   * clinical sign-off practice), sorted by `priority` ascending and capped at
   * 3. When two mappings tie on the same priority, a branch-specific row
   * wins over a tenant-wide one; if still tied, the earliest-created row
   * wins (the `createdAt asc` secondary order below). Each candidate's
   * display name is resolved from `Person` (type USER) or `Doctor` (type
   * CONSULTANT_DOCTOR/REPORTING_DOCTOR) — a soft-deleted underlying record
   * leaves the candidate in the list with `resolvable: false` rather than
   * silently dropping it (dropping would shift a later slot into its place
   * without explanation).
   *
   * Shared by `GET /lab-reports/:id/signatory-candidates` (frontend fetch
   * when the Approve modal opens) and `approve()`'s own re-validation of
   * whatever the client actually submits.
   */
  private async getSignatoryCandidatesInternal(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<LabReportSignatoryCandidatesResponse> {
    const [{ departmentId, categoryId, subCategoryId, report }, settings] =
      await Promise.all([
        this.resolveReportClassificationIds(id, tenantId, branchId),
        this.technicianSettingsService.getForBranch(tenantId, branchId),
      ]);

    const basis = settings.signatoryBasis;
    const classificationId =
      basis === 'category'
        ? categoryId
        : basis === 'subCategory'
          ? subCategoryId
          : departmentId;
    // Report the axis actually used back to the caller as `departmentId` for
    // backward compatibility with the response shape — callers only ever
    // used this field to know "is there a governing classification at all",
    // never specifically the department id.
    if (!classificationId) return { departmentId: null, candidates: [] };

    const mappingWhere = {
      tenantId,
      isSignatory: true,
      deletedAt: null,
      type: {
        in: [
          'USER',
          'CONSULTANT_DOCTOR',
          'REPORTING_DOCTOR',
        ] as PersonMappingType[],
      },
      OR: [{ branchId: report.branchId }, { branchId: null }],
    };
    const mappings =
      basis === 'category'
        ? await this.prisma.categoryPersonMapping.findMany({
            where: { ...mappingWhere, categoryId: classificationId },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          })
        : basis === 'subCategory'
          ? await this.prisma.subCategoryPersonMapping.findMany({
              where: { ...mappingWhere, subCategoryId: classificationId },
              orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
            })
          : await this.prisma.departmentPersonMapping.findMany({
              where: { ...mappingWhere, departmentId: classificationId },
              orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
            });

    // One winner per priority number: prefer branch-specific over tenant-wide;
    // `createdAt asc` above already breaks any remaining tie deterministically.
    const byPriority = new Map<number, (typeof mappings)[number]>();
    for (const m of mappings) {
      const existing = byPriority.get(m.priority);
      if (!existing || (existing.branchId === null && m.branchId !== null)) {
        byPriority.set(m.priority, m);
      }
    }
    const winners = [...byPriority.values()]
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 3);

    const userIds = winners
      .filter((m) => m.type === 'USER')
      .map((m) => m.personId);
    const doctorIds = winners
      .filter(
        (m) => m.type === 'CONSULTANT_DOCTOR' || m.type === 'REPORTING_DOCTOR',
      )
      .map((m) => m.personId);

    const [persons, doctors] = await Promise.all([
      userIds.length
        ? this.prisma.person.findMany({
            where: { id: { in: userIds }, deletedAt: null },
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              designation: true,
            },
          })
        : Promise.resolve([]),
      doctorIds.length
        ? this.prisma.doctor.findMany({
            where: { id: { in: doctorIds }, tenantId, deletedAt: null },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              signatoryDesignation: true,
              registrationCouncil: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const personById = new Map(persons.map((p) => [p.id, p]));
    const doctorById = new Map(doctors.map((d) => [d.id, d]));

    const candidates: LabReportSignatoryCandidate[] = winners.map(
      (m, index) => {
        if (m.type === 'USER') {
          const p = personById.get(m.personId);
          return {
            slot: (index + 1) as 1 | 2 | 3,
            priority: m.priority,
            personId: m.personId,
            type: 'USER',
            displayName: p
              ? fullName([p.firstName, p.middleName, p.lastName])
              : '(Unavailable)',
            designation: p?.designation ?? null,
            resolvable: Boolean(p),
          };
        }
        const d = doctorById.get(m.personId);
        return {
          slot: (index + 1) as 1 | 2 | 3,
          priority: m.priority,
          personId: m.personId,
          type: m.type as 'CONSULTANT_DOCTOR' | 'REPORTING_DOCTOR',
          displayName: d
            ? fullName([d.firstName, d.lastName])
            : '(Unavailable)',
          designation:
            d?.signatoryDesignation ?? d?.registrationCouncil ?? null,
          resolvable: Boolean(d),
        };
      },
    );

    return { departmentId: classificationId, candidates };
  }

  async getSignatoryCandidates(
    id: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<LabReportSignatoryCandidatesResponse> {
    const activeBranchId = this.requireBranch(branchId);
    return this.getSignatoryCandidatesInternal(id, tenantId, activeBranchId);
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
      ...new Set(
        rows.map((r) => r.labTestId).filter((id): id is string => id !== null),
      ),
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
        testParams && testParams.length === 1
          ? testParams[0]!.resultType
          : null;
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
   * `OrderSample` (a test needing both a blood tube and a urine cup —
   * see `OrderSampleService.generateForOrderInTx`'s per-sample-type
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

    const sampleTests = await this.prisma.orderSampleTest.findMany({
      where: { orderItemId: { in: orderItemIds }, tenantId, deletedAt: null },
      select: {
        orderItemId: true,
        sample: { select: { id: true, status: true } },
      },
    });

    const samplesByOrderItem = new Map<string, Map<string, SampleStatus>>();
    for (const { orderItemId, sample } of sampleTests) {
      const bySampleId =
        samplesByOrderItem.get(orderItemId) ?? new Map<string, SampleStatus>();
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

  /**
   * Resolves which tests (if any) are assigned to a multi-step process and
   * which stage they're at (LABORATORY.docx §5.7), for list views like Order
   * Overview that need this at a glance without opening each report's own
   * detail. `MultiStepTestProcess.labReportId` is unique per report, so this
   * is a direct one-query batched lookup — no per-sample fan-out like
   * `attachSampleStatuses`, since a report has at most one multi-step
   * process row. Null for the overwhelming majority of tests, which are
   * never assigned to one.
   */
  private async attachMultiStepProcess(
    rows: LabReportWorklistRow[],
  ): Promise<LabReportWorklistRow[]> {
    const reportIds = [...new Set(rows.map((r) => r.id))];
    if (reportIds.length === 0) return rows;

    const processes = await this.prisma.multiStepTestProcess.findMany({
      where: { labReportId: { in: reportIds }, deletedAt: null },
      select: { labReportId: true, processType: true, currentStage: true },
    });
    const byReportId = new Map(processes.map((p) => [p.labReportId, p]));

    return rows.map((row) => {
      const process = byReportId.get(row.id);
      return {
        ...row,
        multiStepProcessType: process?.processType ?? null,
        multiStepStage: process?.currentStage ?? null,
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

    const [
      branches,
      referredByDoctors,
      referralPanels,
      departments,
      labTests,
      labPanels,
    ] = await Promise.all([
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
      this.getResultParams(report.labTestId, report.orderItem.branchLabPanelId),
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

    let worklistRow = (
      await this.attachSampleStatuses(tenantId, [toWorklistRow(report)])
    )[0]!;
    worklistRow = (await this.attachBranchNames(tenantId, [worklistRow]))[0]!;
    worklistRow = (
      await this.attachDepartmentNames(tenantId, [worklistRow])
    )[0]!;
    worklistRow = (await this.attachResultTypes([worklistRow]))[0]!;
    worklistRow = (await this.attachMultiStepProcess([worklistRow]))[0]!;

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
   * Persists a technician's edit to "Useful For"/"Interpretation" — gated
   * per-field by the branch's `TechnicianSetting.isUsefulForEditable`/
   * `isInterpretationEditable` (both default false; LABORATORY.docx §4.5
   * describes these as normally read-only, Admin-configured content). Writes
   * straight through to the underlying master `LabTest` record (the same one
   * `getContentSections` reads from) via `LabTestService.update` — this is a
   * shared-record edit, not a per-report override: it affects every other
   * order that uses this same test, by design (confirmed with the user).
   * Silently no-ops a field that's present in the DTO but whose setting is
   * off, rather than rejecting the whole request — lets the frontend send
   * both fields unconditionally without needing to know which one is
   * currently allowed.
   */
  async updateContentSections(
    id: string,
    tenantId: string,
    branchId: string | null,
    dto: UpdateContentSectionsDto,
  ): Promise<LabReportContentSections> {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    if (!report.labTestId) {
      return {
        usefulFor: null,
        interpretation: null,
        limitations: null,
        references: null,
      };
    }

    const settings = await this.technicianSettingsService.getForBranch(
      tenantId,
      activeBranchId,
    );
    const patch: { usefulFor?: string; interpretationOfResults?: string } = {};
    if (settings.isUsefulForEditable && dto.usefulFor !== undefined) {
      patch.usefulFor = dto.usefulFor;
    }
    if (settings.isInterpretationEditable && dto.interpretation !== undefined) {
      patch.interpretationOfResults = dto.interpretation;
    }

    if (Object.keys(patch).length > 0) {
      const labTest = await this.prisma.labTest.findFirst({
        where: { id: report.labTestId, deletedAt: null },
        select: { masterDataId: true },
      });
      if (labTest?.masterDataId) {
        await this.labTestService.update(
          labTest.masterDataId,
          report.labTestId,
          tenantId,
          patch,
        );
      }
    }

    return this.getContentSections(tenantId, report.labTestId);
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
  /**
   * Resolve a report's result-parameter definitions. `LabReport.labTestId` is
   * only set for a single-test report — a panel report leaves it null (per
   * its own doc comment), so for a panel this instead walks
   * `BranchLabPanel` -> its constituent `BranchLabPanelTest`s ->
   * `BranchLabTest.sourceLabTestId` to collect every member test's params
   * (concatenated in the panel's own test `sortOrder`, per test). Without
   * this fallback, every panel report would show zero result parameters
   * regardless of how much result data actually exists (the Report View
   * modal and Print/Download are both driven by this list, not by
   * `resultValues` directly).
   */
  private async getResultParams(
    labTestId: string | null,
    branchLabPanelId?: string | null,
  ): Promise<LabReportResultParam[]> {
    if (labTestId) return this.fetchResultParams(labTestId);
    if (!branchLabPanelId) return [];

    // `BranchLabPanelTest.branchLabTestId` is a raw FK (no Prisma relation
    // field on the model) — resolve the member `BranchLabTest`s separately.
    const panelTests = await this.prisma.branchLabPanelTest.findMany({
      where: { branchLabPanelId, deletedAt: null },
      select: { branchLabTestId: true },
      orderBy: { sortOrder: 'asc' },
    });
    const branchLabTestIds = panelTests.map((t) => t.branchLabTestId);
    if (branchLabTestIds.length === 0) return [];

    const branchLabTests = await this.prisma.branchLabTest.findMany({
      where: { id: { in: branchLabTestIds } },
      select: { id: true, sourceLabTestId: true },
    });
    const sourceLabTestIdById = new Map(
      branchLabTests.map((t) => [t.id, t.sourceLabTestId]),
    );
    const sourceLabTestIds = branchLabTestIds
      .map((id) => sourceLabTestIdById.get(id))
      .filter((id): id is string => id != null);
    if (sourceLabTestIds.length === 0) return [];

    const paramsByTest = await Promise.all(
      sourceLabTestIds.map((id) => this.fetchResultParams(id)),
    );
    return paramsByTest.flat();
  }

  private async fetchResultParams(
    labTestId: string,
  ): Promise<LabReportResultParam[]> {
    return this.prisma.labTestResultParam.findMany({
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
  }

  private async requireReport(id: string, tenantId: string, branchId: string) {
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!report) throw new LabReportNotFoundException(id);
    if (report.isLocked) throw new LabReportLockedException(id);

    // Safety net (see LabReportSampleMissingException's own doc comment for
    // why this should never fire for a genuine report, and what it guards
    // against when it does).
    const hasSample = await this.prisma.orderSampleTest.findFirst({
      where: { orderItemId: report.orderItemId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!hasSample) throw new LabReportSampleMissingException(id);

    return report;
  }

  /**
   * Shared by `save()` and `submit()` (LABORATORY.docx §2.2's transition
   * matrix names both triggers "Technician enters results -> Save/Submit" —
   * neither transition is meant to be reachable from a completely empty
   * result grid). `upsertResultValues` itself allows every field to be
   * blank (a `LabReportResultValue` row can exist with `resultParamId` only,
   * e.g. right after Sync resolves a reference range but before an
   * observed value is typed), so this is the one place that actually
   * checks for a real entered value. Threshold is "at least one real
   * value" across however many parameters the test has — not "every
   * parameter filled in" — so genuine partial progress on a multi-parameter
   * test across several Save clicks stays allowed.
   */
  private async requireAtLeastOneResultValue(
    id: string,
    tenantId: string,
  ): Promise<void> {
    const hasRealValue = await this.prisma.labReportResultValue.findFirst({
      where: {
        labReportId: id,
        tenantId,
        deletedAt: null,
        observed1: { not: null },
        NOT: { observed1: '' },
      },
      select: { id: true },
    });
    if (!hasRealValue) throw new LabReportResultsRequiredException(id);
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

  /**
   * Public entry point for the 5 special worklist services (Re-Run, Critical
   * Alert, Out of Range, Delta Check, Scheduled Test) to record their own
   * raise/status-update actions into the same Audit Trail as the main report
   * transitions — required by LABORATORY.docx §5.11 ("the complete history
   * of the order/report — every action, status change...") and §8.1-8.5
   * (each worklist explicitly lists "Audit Trail" as an available action).
   *
   * Each worklist has its own status vocabulary (`ReRunStatus`,
   * `AlertReviewStatus`, `ScheduledTestStatus`) distinct from `LabReportStatus`, so
   * `fromStatus`/`toStatus` (strictly typed to `LabReportStatus` in the
   * schema) can't literally hold those values — instead the worklist's own
   * transition is folded into `action`/`notes` as free text, and
   * `toStatus`/`fromStatus` are both set to the report's real current status
   * (unchanged by this call), since no actual `LabReport` status change
   * happened here.
   */
  async recordWorklistHistory(
    tenantId: string,
    labReportId: string,
    action: string,
    actorId: string,
    notes?: string,
  ): Promise<void> {
    const report = await this.prisma.labReport.findFirst({
      where: { id: labReportId, tenantId, deletedAt: null },
      select: { status: true },
    });
    if (!report) return;
    await this.prisma.withTenant(tenantId, (tx) =>
      this.recordHistory(
        tx,
        tenantId,
        labReportId,
        report.status,
        report.status,
        action,
        actorId,
        notes,
      ),
    );
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
            // The upsert's `where` matches by the labReportId+resultParamId
            // unique key regardless of deletedAt, so a slot that was ever
            // soft-deleted (e.g. by a Re-Run reset) would otherwise be
            // silently re-written while staying deletedAt-stamped — invisible
            // to every read path (LAB_REPORT_DETAIL_INCLUDE filters
            // deletedAt: null) even though the value was genuinely saved.
            deletedAt: null,
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
   * The distinct methodologies actually configured for a parameter — i.e. every
   * `LabTestReferenceRange`/`LabTestReferenceValue.method` value on record for it,
   * plus the parameter's own default `method` if set. Backs the Methodology
   * dropdown on the Test Entry screen so its options come from what Admin
   * configured rather than a fixed guess, and so a technician's selection is
   * guaranteed to match a real reference-range row for `resolveReferenceRange`.
   */
  async listMethodsForParam(
    id: string,
    tenantId: string,
    branchId: string | null,
    query: ReferenceRangeMethodsQueryDto,
  ): Promise<{ methods: string[] }> {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId: activeBranchId, deletedAt: null },
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

    const methods = new Set<string>();
    if (param.method) methods.add(param.method);

    if (param.resultType === 'QUALITATIVE') {
      const values = await this.prisma.labTestReferenceValue.findMany({
        where: { paramId: param.id, deletedAt: null, method: { not: null } },
        select: { method: true },
      });
      for (const v of values) if (v.method) methods.add(v.method);
    } else {
      const ranges = await this.prisma.labTestReferenceRange.findMany({
        where: { paramId: param.id, deletedAt: null, method: { not: null } },
        select: { method: true },
      });
      for (const r of ranges) if (r.method) methods.add(r.method);
    }

    return { methods: [...methods] };
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
            `${match.lowerLimit?.toString() ?? ''} - ${match.upperLimit?.toString() ?? ''}`.trim(),
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
   * Resolves this report's stored `signatoryAuthority1/2/3Id`+`Type` columns
   * (LABORATORY.docx "Final Report Signature Order" — Priority 1 → 2 → 3,
   * only the selected/configured slots appear, no empty placeholder for a
   * skipped one) into the PDF template's `SigningAuthorityDto[]` shape. Same
   * USER→Person / CONSULTANT_DOCTOR|REPORTING_DOCTOR→Doctor resolution as
   * `getSignatoryCandidatesInternal`, but reading the report's own frozen
   * columns rather than live `DepartmentPersonMapping` candidates — this is
   * deliberately a snapshot read: what actually got chosen and stored at
   * Approve time, not what the department/category/sub-category's mapping
   * says today. A slot whose underlying Person/Doctor was since soft-deleted
   * is simply omitted from the printed signature block (unlike the Approve
   * modal's candidate list, which flags it `resolvable: false` instead —
   * there's no "disabled" concept on a finished PDF, so silently dropping is
   * the closest equivalent to that same "don't fabricate a signature" rule).
   */
  private async resolveStoredSignatories(
    report: Pick<
      LabReportDetailWithContent,
      | 'signatoryAuthority1Id'
      | 'signatoryAuthority1Type'
      | 'signatoryAuthority2Id'
      | 'signatoryAuthority2Type'
      | 'signatoryAuthority3Id'
      | 'signatoryAuthority3Type'
    >,
    tenantId: string,
  ): Promise<SigningAuthorityDto[]> {
    const slots = [
      {
        id: report.signatoryAuthority1Id,
        type: report.signatoryAuthority1Type,
      },
      {
        id: report.signatoryAuthority2Id,
        type: report.signatoryAuthority2Type,
      },
      {
        id: report.signatoryAuthority3Id,
        type: report.signatoryAuthority3Type,
      },
    ].filter((s): s is { id: string; type: PersonMappingType } =>
      Boolean(s.id && s.type),
    );
    if (slots.length === 0) return [];

    const userIds = slots.filter((s) => s.type === 'USER').map((s) => s.id);
    const doctorIds = slots
      .filter(
        (s) => s.type === 'CONSULTANT_DOCTOR' || s.type === 'REPORTING_DOCTOR',
      )
      .map((s) => s.id);

    const [persons, doctors] = await Promise.all([
      userIds.length
        ? this.prisma.person.findMany({
            where: { id: { in: userIds }, deletedAt: null },
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              designation: true,
            },
          })
        : Promise.resolve([]),
      doctorIds.length
        ? this.prisma.doctor.findMany({
            where: { id: { in: doctorIds }, tenantId, deletedAt: null },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              signatoryDesignation: true,
              registrationCouncil: true,
              isNablAuthorized: true,
              isCapCertified: true,
              isIsoCertified: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const personById = new Map(persons.map((p) => [p.id, p]));
    const doctorById = new Map(doctors.map((d) => [d.id, d]));

    const signatories: SigningAuthorityDto[] = [];
    for (const slot of slots) {
      if (slot.type === 'USER') {
        const p = personById.get(slot.id);
        if (p) {
          signatories.push({
            name: fullName([p.firstName, p.middleName, p.lastName]),
            designation: p.designation ?? undefined,
          });
        }
      } else {
        const d = doctorById.get(slot.id);
        if (d) {
          const certifications = [
            d.isNablAuthorized ? 'NABL Authorized' : null,
            d.isCapCertified ? 'CAP Certified' : null,
            d.isIsoCertified ? 'ISO Certified' : null,
          ]
            .filter((c): c is string => c !== null)
            .join(', ');
          signatories.push({
            name: fullName([d.firstName, d.lastName]),
            designation:
              d.signatoryDesignation ?? d.registrationCouncil ?? undefined,
            certifications: certifications || undefined,
          });
        }
      }
    }
    return signatories;
  }

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
    const testOrPanel =
      report.orderItem.branchLabTest ?? report.orderItem.branchLabPanel;

    const signatories = await this.resolveStoredSignatories(report, tenantId);

    // The sample this report's test was drawn from — `OrderSampleTest`/
    // `OrderSample` are raw FKs (no Prisma relation field on `LabReport`),
    // resolved via the same `orderItemId` `LabReport` already carries.
    // Per-(test × sample) generation means at most one active row.
    const sampleTest = await this.prisma.orderSampleTest.findFirst({
      where: { orderItemId: report.orderItemId, deletedAt: null },
      select: {
        sample: {
          select: {
            collectedAt: true,
            receivedAt: true,
            sampleType: true,
            sampleGroupLabel: true,
            barcode: true,
          },
        },
      },
    });
    const sample = sampleTest?.sample;

    // Most recent SAMPLE-category note (append-only log — latest wins).
    const sampleNote = await this.prisma.labReportNote.findFirst({
      where: { labReportId: report.id, category: 'SAMPLE' },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    });

    // `LabReportResultValue.resultParamId` is a raw FK (no Prisma relation
    // field on the model) — batch-fetch the parameter names separately
    // rather than one query per row.
    const resultParamIds = [
      ...new Set(report.resultValues.map((v) => v.resultParamId)),
    ];
    const resultParams =
      resultParamIds.length === 0
        ? []
        : await this.prisma.labTestResultParam.findMany({
            where: { id: { in: resultParamIds } },
            select: { id: true, parameterName: true, groupName: true },
          });
    const paramNameById = new Map(
      resultParams.map((p) => [p.id, p.parameterName]),
    );
    const groupNameByParamId = new Map(
      resultParams.map((p) => [p.id, p.groupName ?? '']),
    );

    const results = report.resultValues.map((v) => ({
      parameter_name: paramNameById.get(v.resultParamId) ?? '',
      observed1: v.observed1 ?? '',
      observed2: v.observed2 ?? '',
      unit: v.unit ?? '',
      methodology: v.methodology ?? '',
      reference_display: v.referenceDisplay ?? '',
      group_name: groupNameByParamId.get(v.resultParamId) ?? '',
    }));

    return {
      variables: {
        order_code: order.orderCode,
        order_date: order.orderDate.toISOString().slice(0, 10),
        order_external_id: order.externalOrderId ?? '',
        patient_name: [patient.firstName, patient.middleName, patient.lastName]
          .filter(Boolean)
          .join(' '),
        patient_salutation: patient.salutation ?? '',
        patient_age: patient.age ?? '',
        patient_gender: patient.gender ?? '',
        patient_um_id: patient.umId ?? '',
        patient_mobile: patient.mobile ?? '',
        referred_by: order.referredByDoctor
          ? [order.referredByDoctor.firstName, order.referredByDoctor.lastName]
              .filter(Boolean)
              .join(' ')
          : '',
        referral_panel: order.referralPanel?.name ?? '',
        test_name:
          (testOrPanel && 'testName' in testOrPanel
            ? testOrPanel.testName
            : undefined) ??
          (testOrPanel && 'panelName' in testOrPanel
            ? testOrPanel.panelName
            : undefined) ??
          report.orderItem.direct ??
          '',
        report_status: report.status,
        useful_for: report.contentSections.usefulFor ?? '',
        interpretation: report.contentSections.interpretation ?? '',
        limitations: report.contentSections.limitations ?? '',
        references: report.contentSections.references ?? '',
        last_report_prepared_on: report.publishedAt
          ? report.publishedAt.toISOString().slice(0, 10)
          : '',
        sample_collected_date: sample?.collectedAt
          ? sample.collectedAt.toISOString().slice(0, 10)
          : '',
        sample_received_date: sample?.receivedAt
          ? sample.receivedAt.toISOString().slice(0, 10)
          : '',
        sample_type: sample?.sampleType ?? '',
        sample_source_label: sample?.sampleGroupLabel ?? sample?.sampleType ?? '',
        order_id_barcode: sample?.barcode ?? '',
        sample_note: sampleNote?.body ?? '',
      },
      sections: { results },
      signatories,
    };
  }

  /**
   * Print/Download a report (LABORATORY.docx §6.10's "Print / Download"
   * action). Resolves the tenant's active template of `type` (or the
   * caller's explicit `templateId`) and renders it with this report's real
   * data via `PdfReportTemplateService.generatePdf`.
   * @param type which `PdfReportTemplate` type to resolve against when
   * `templateId` is omitted — `lab_report` (single test) or `lab_panel`.
   * Ignored when `templateId` is given explicitly.
   * @throws NoActivePrintTemplateException if no active template exists
   * @throws AmbiguousPrintTemplateException if multiple exist and no
   * `templateId` was given
   */
  async print(
    id: string,
    tenantId: string,
    branchId: string | null,
    templateId?: string,
    type: 'lab_report' | 'lab_panel' = 'lab_report',
  ): Promise<Buffer> {
    const context = await this.buildPrintContext(id, tenantId, branchId);
    const resolvedTemplateId =
      templateId ?? (await this.resolvePrintTemplateId(tenantId, type));
    return this.pdfReportTemplateService.generatePdf(
      resolvedTemplateId,
      tenantId,
      context,
    );
  }

  private async resolvePrintTemplateId(
    tenantId: string,
    type: PdfReportTemplateType = 'lab_report',
  ): Promise<string> {
    const { data } = await this.pdfReportTemplateService.findAllForTenant(
      tenantId,
      1,
      10,
      {
        type,
        status: 'ACTIVE',
      },
    );
    if (data.length === 0) throw new NoActivePrintTemplateException(tenantId);
    if (data.length > 1) {
      throw new AmbiguousPrintTemplateException(
        tenantId,
        data.map((t) => t.id),
      );
    }
    return data[0]!.id;
  }

  /**
   * Print All (order-console's "Lab All Report" action, PDF templates
   * integration checklist item 3). Unlike {@link print} (one report, one
   * template render), this renders ONE `lab_all_report`-type template ONCE,
   * with every one of the order's reports' result rows flattened into a
   * single `sections.results` row-set (each row carries its own `test_name`
   * so the body table reads as one continuous report, test by test).
   *
   * Deliberately flat, not nested (`sections.reports[].results`):
   * `TemplateRenderService.interpolateSections` only expands ONE level of
   * `{{#each}}` — it has no per-row nested-loop support — so a template
   * author cannot write "for each report, for each result" in one pass.
   * Flattening avoids that limitation entirely rather than extending the
   * shared renderer (which every other template type also depends on) for
   * this one case.
   * @param orderItemIds when given (non-empty), restricts the consolidated
   * PDF to only these order items' reports instead of every report on the
   * order — used by the Order Overview modal's multi-select bulk actions.
   * @throws OrderReportsNotFoundException if the order (or the selected
   * items) has no lab reports (wrong id, or no item has reached ACCEPTED yet)
   * @throws NoActivePrintTemplateException if no active `lab_all_report`
   * template exists
   * @throws AmbiguousPrintTemplateException if multiple exist and no
   * `templateId` was given
   */
  async printAllForOrder(
    orderId: string,
    tenantId: string,
    branchId: string | null,
    templateId?: string,
    orderItemIds?: string[],
  ): Promise<Buffer> {
    const activeBranchId = this.requireBranch(branchId);
    const reportRows = await this.prisma.labReport.findMany({
      where: {
        tenantId,
        branchId: activeBranchId,
        deletedAt: null,
        orderItem: { orderId },
        ...(orderItemIds && orderItemIds.length > 0
          ? { orderItemId: { in: orderItemIds } }
          : {}),
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (reportRows.length === 0) {
      throw new OrderReportsNotFoundException(orderId);
    }

    const contexts = await Promise.all(
      reportRows.map((r) => this.buildPrintContext(r.id, tenantId, branchId)),
    );
    const first = contexts[0]!;
    const combined: GeneratePdfDto = {
      // Order/patient variables are identical across every report on the
      // same order — the first context's is as good as any.
      variables: first.variables,
      signatories: first.signatories,
      sections: {
        results: contexts.flatMap((c) => {
          const testName = c.variables?.test_name ?? '';
          const rows = c.sections?.results ?? [];
          // A report with no result rows yet still gets one row (test name
          // visible, blanks for the observed value) so it isn't silently
          // dropped from the consolidated report.
          return rows.length > 0
            ? rows.map((row) => ({ test_name: testName, ...row }))
            : [
                {
                  test_name: testName,
                  parameter_name: '',
                  observed1: '',
                  observed2: '',
                  unit: '',
                  methodology: '',
                  reference_display: '',
                },
              ];
        }),
      },
    };

    const resolvedTemplateId =
      templateId ??
      (await this.resolvePrintTemplateId(tenantId, 'lab_all_report'));
    return this.pdfReportTemplateService.generatePdf(
      resolvedTemplateId,
      tenantId,
      combined,
    );
  }

  /**
   * "Share and Inform" (Order Console): send the order's lab report to the
   * patient over one channel (Email / SMS / WhatsApp), using the tenant's
   * ACTIVATED `console_lab_report_as_attachment` template — no template picker.
   * Email/WhatsApp carry the rendered `lab_all_report` PDF as an attachment; SMS
   * is text-only. Delegates delivery to the communication queue/worker.
   *
   * @param orderId the order whose report is shared
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT) — required for report rendering
   * @param dto the chosen channel + optional recipient override
   * @param actorId the sending user (audit trail)
   * @returns the queued communication log row(s)
   * @throws ShareTemplateNotActivatedException if no activated template for the channel
   * @throws ShareRecipientMissingException if no address/number for the channel
   */
  async shareOrderReport(
    orderId: string,
    tenantId: string,
    branchId: string | null,
    dto: ShareOrderReportDto,
    actorId: string,
  ) {
    const ctx = await this.loadOrderForShare(orderId, tenantId);
    const getPdf = this.makeSharePdfProvider(orderId, tenantId, branchId);

    if (dto.channel === MessagingChannel.IAM) {
      // Single-channel in-app share — no communication_logs row is created
      // (IAM lives in the notifications table), so return an empty log array.
      await this.dispatchIamShare(ctx, tenantId, branchId, actorId);
      return [];
    }
    return this.dispatchDeliverableShare(
      ctx,
      tenantId,
      branchId,
      dto.channel,
      dto.toAddress,
      actorId,
      getPdf,
    );
  }

  /**
   * "Share All" (Order Console): send the order's lab report to the patient
   * over EVERY channel the tenant has activated a
   * `console_lab_report_as_attachment` template for — Email, SMS, WhatsApp and
   * the in-app message (IAM) — in one request. Each channel is attempted
   * independently and never aborts the others: a channel with no activated
   * template (or no recipient on file) is reported `SKIPPED`, a genuine error
   * is `FAILED`, and a successfully queued/created one is `QUEUED`. The
   * report PDF is rendered at most once and reused across Email/WhatsApp.
   *
   * @param orderId the order whose report is shared
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param dto optional per-channel recipient overrides
   * @param actorId the sending user (audit trail + IAM sender)
   * @returns a per-channel result summary
   * @throws OrderReportsNotFoundException if the order isn't in the tenant
   */
  async shareAllForOrder(
    orderId: string,
    tenantId: string,
    branchId: string | null,
    dto: ShareAllOrderReportDto,
    actorId: string,
  ): Promise<ShareAllResult> {
    const ctx = await this.loadOrderForShare(orderId, tenantId);
    const getPdf = this.makeSharePdfProvider(orderId, tenantId, branchId);

    const overrideFor = (channel: MessagingChannel): string | undefined =>
      channel === MessagingChannel.EMAIL
        ? dto.email
        : channel === MessagingChannel.SMS
          ? dto.sms
          : channel === MessagingChannel.WHATSAPP
            ? dto.whatsapp
            : undefined;

    const results: ShareChannelResult[] = [];

    for (const channel of [
      MessagingChannel.EMAIL,
      MessagingChannel.SMS,
      MessagingChannel.WHATSAPP,
    ]) {
      try {
        const logs = await this.dispatchDeliverableShare(
          ctx,
          tenantId,
          branchId,
          channel,
          overrideFor(channel),
          actorId,
          getPdf,
        );
        results.push({ channel, status: 'QUEUED', logId: logs[0]?.id });
      } catch (err) {
        results.push(this.shareService.classifyError(channel, err));
      }
    }

    // In-app message (IAM) — targets the staff sender + order creator in-app.
    try {
      const notificationId = await this.dispatchIamShare(
        ctx,
        tenantId,
        branchId,
        actorId,
      );
      results.push({
        channel: MessagingChannel.IAM,
        status: 'QUEUED',
        logId: notificationId,
      });
    } catch (err) {
      results.push(this.shareService.classifyError(MessagingChannel.IAM, err));
    }

    return { orderId: ctx.order.id, results };
  }

  /** Order + patient contact for a share, or throws if the order isn't found. */
  private async loadOrderForShare(orderId: string, tenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: {
        id: true,
        orderCode: true,
        createdBy: true,
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            mobile: true,
            whatsappNumber: true,
          },
        },
      },
    });
    if (!order) {
      throw new OrderReportsNotFoundException(orderId);
    }
    const patient = order.patient;
    const patientName = [patient?.firstName, patient?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    // Business name + timezone drive the share template's {web_title}/{user_name}
    // and {date}/{time} variables. Tenant is platform-level (no RLS scope).
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    });
    const settings =
      (tenant?.settings as { timezone?: string } | null) ?? null;
    const businessName = tenant?.name ?? '';
    const timezone = settings?.timezone ?? null;
    return { order, patient, patientName, businessName, timezone };
  }

  /**
   * A memoized base64 render of the order's consolidated lab-report PDF: the
   * first call renders (via `printAllForOrder`), subsequent calls return the
   * cache — so a "Share All" over both Email and WhatsApp renders once, not
   * twice. Only invoked for channels that carry the attachment.
   */
  private makeSharePdfProvider(
    orderId: string,
    tenantId: string,
    branchId: string | null,
  ): () => Promise<string> {
    let cache: string | null = null;
    return async (): Promise<string> => {
      if (cache === null) {
        const pdf = await this.printAllForOrder(orderId, tenantId, branchId);
        cache = pdf.toString('base64');
      }
      return cache;
    };
  }

  /**
   * The patient `ShareRecipient` for a lab-report share's deliverable channels —
   * Email → `email`, WhatsApp → `whatsappNumber` (falling back to `mobile`),
   * SMS → `mobile`.
   */
  private shareRecipient(
    ctx: Awaited<ReturnType<LabReportService['loadOrderForShare']>>,
  ): ShareRecipient {
    const { patient, patientName } = ctx;
    return {
      recipientId: patient?.id ?? null,
      recipientName: patientName || null,
      type: RecipientType.PATIENT,
      email: patient?.email ?? null,
      sms: patient?.mobile ?? null,
      whatsapp: patient?.whatsappNumber ?? patient?.mobile ?? null,
    };
  }

  /**
   * Template `{variables}` shared across a lab-report share's channels. Includes
   * the approved WhatsApp `send_report_as_attachment` variables
   * (`pfn`/`order_number`/`user_name`/`date`/`time`/`web_title`) — whose order in
   * the template body drives the positional `template_params` — alongside the
   * legacy `pn`/`patient_name`/`order_code` aliases used by other channel bodies.
   */
  private shareVariables(
    ctx: Awaited<ReturnType<LabReportService['loadOrderForShare']>>,
  ): Record<string, string> {
    const { order, patientName, businessName, timezone } = ctx;
    const orderCode = order.orderCode ?? '';
    const now = new Date();
    const business = businessName || 'Lab';
    return {
      // WhatsApp `send_report_as_attachment` variables (order mirrors the body).
      pfn: patientName || 'Patient',
      order_number: orderCode,
      user_name: business,
      date: this.formatDate(now, timezone),
      time: this.formatTime(now, timezone),
      web_title: business,
      // Legacy aliases used by Email/SMS/IAM template bodies.
      pn: patientName,
      patient_name: patientName,
      order_code: orderCode,
    };
  }

  /** Format a date as `DD Mon YYYY` in the business timezone (UTC if null). */
  private formatDate(d: Date, timezone: string | null): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone ?? undefined,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d);
  }

  /** Format a time as `hh:mm AM/PM` in the business timezone (UTC if null). */
  private formatTime(d: Date, timezone: string | null): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone ?? undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  }

  /**
   * Resolve + enqueue a single deliverable-channel (Email/SMS/WhatsApp) share of
   * the order's report to the patient — delegates to the reusable `ShareService`
   * with the patient recipient + the rendered lab-report PDF. Email/WhatsApp carry
   * the PDF (from `getPdf`); SMS is text-only.
   */
  private dispatchDeliverableShare(
    ctx: Awaited<ReturnType<LabReportService['loadOrderForShare']>>,
    tenantId: string,
    branchId: string | null,
    channel: MessagingChannel,
    toAddressOverride: string | undefined,
    actorId: string,
    getPdf: () => Promise<string>,
  ) {
    return this.shareService.dispatchDeliverable(
      tenantId,
      branchId,
      LabReportService.SHARE_FEATURE,
      channel,
      this.shareRecipient(ctx),
      toAddressOverride,
      actorId,
      getPdf,
      this.shareVariables(ctx),
      `lab-report-${ctx.order.orderCode ?? ctx.order.id}.pdf`,
    );
  }

  /**
   * Raise the in-app (IAM) confirmation for a shared report — delegates to
   * `ShareService`. Recipients are the **staff sender** and the **order's
   * creator** (deduped), addressed as `STAFF` so the alert lands in their
   * notification bell. The patient is intentionally NOT targeted: patients don't
   * log into the business app (they still get the report over Email/SMS/WhatsApp).
   */
  private dispatchIamShare(
    ctx: Awaited<ReturnType<LabReportService['loadOrderForShare']>>,
    tenantId: string,
    branchId: string | null,
    actorId: string,
  ): Promise<string> {
    const recipientIds = [
      ...new Set(
        [actorId, ctx.order.createdBy].filter((id): id is string => !!id),
      ),
    ];
    return this.shareService.dispatchIam(
      tenantId,
      branchId,
      LabReportService.SHARE_FEATURE,
      recipientIds.map((id) => ({ entityId: id, entityType: 'STAFF' })),
      actorId,
      this.shareVariables(ctx),
      {
        verb: 'lab_report_shared',
        subject: 'Lab report shared',
        actorEntityType: 'STAFF',
      },
    );
  }

  /**
   * Preload for the Share and Inform popup: the patient's contacts + which
   * channels the tenant has ACTIVATED a `console_lab_report_as_attachment`
   * template for (so the UI auto-fills recipients and enables only the usable
   * channels — no template picker). One call drives the whole popup.
   *
   * @param orderId the order being shared
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @returns order code, patient name, and a per-channel {activated, toAddress}
   * @throws OrderReportsNotFoundException if the order isn't in the tenant
   */
  async getShareInfo(
    orderId: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<ShareInfo> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: {
        id: true,
        orderCode: true,
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            mobile: true,
            whatsappNumber: true,
          },
        },
      },
    });
    if (!order) {
      throw new OrderReportsNotFoundException(orderId);
    }
    const p = order.patient;
    const patientName = [p?.firstName, p?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const contactFor = (channel: MessagingChannel): string | null =>
      channel === MessagingChannel.EMAIL
        ? (p?.email ?? null)
        : channel === MessagingChannel.WHATSAPP
          ? (p?.whatsappNumber ?? p?.mobile ?? null)
          : channel === MessagingChannel.SMS
            ? (p?.mobile ?? null)
            : null; // IAM (in-app) has no external address

    const channels = await this.shareService.getChannelInfo(
      tenantId,
      branchId,
      LabReportService.SHARE_FEATURE,
      [
        MessagingChannel.EMAIL,
        MessagingChannel.SMS,
        MessagingChannel.WHATSAPP,
        MessagingChannel.IAM,
      ],
      contactFor,
    );
    return {
      orderId: order.id,
      orderCode: order.orderCode,
      patientName,
      patientId: p?.id ?? null,
      channels,
    };
  }

  // ── Save / Submit ──────────────────────────────────────────────────────────

  async save(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('save', report.status);

    // Bug fix: originally left unguarded (Submit alone was guarded), on the
    // assumption an empty Save was a legitimate "save partial progress"
    // action. Re-checked LABORATORY.docx directly: §2.2's own transition
    // matrix names the trigger "Technician enters results -> Save", and
    // §4.6/the Saved status definition both tie Save to having "entered/
    // edited results" — an empty grid was never actually meant to reach
    // Saved either. Same "at least one real value" threshold as Submit
    // (not "every parameter filled in") — still allows genuine partial
    // progress across multiple Save clicks on a multi-parameter test.
    await this.requireAtLeastOneResultValue(id, tenantId);

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

    // Bug fix: upsertResultValues allows every field to be blank, and
    // nothing previously stopped a fully-empty result from being submitted
    // for validation. Submit means "this is ready" — require at least one
    // real value (same helper/threshold `save()` now also uses).
    await this.requireAtLeastOneResultValue(id, tenantId);

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

    // SRS §5.4/§5.5: a result finished after today's reporting cutoff
    // (reportingTimeTo - approvalDurationMax) defers to the next Reporting
    // session — stamped here (not blocked), enforced later by approve().
    const deferral = await this.tatService.resolveReportingDeferral(
      id,
      tenantId,
      activeBranchId,
    );

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: {
          status: LabReportStatus.RESULT_DONE,
          validatedAt: new Date(),
          validatedBy: actorId,
          reportingDeferredUntil: deferral.deferredUntil,
        },
      });
      if (notes) {
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId: id,
            category: 'TECH',
            body: notes,
            createdBy: actorId,
          },
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

  /**
   * Validates the DTO's `signatoryAuthority*Id` fields against a freshly
   * re-fetched candidate list (never trusts whatever the client fetched when
   * the Approve modal opened — the department's Person Mapping config could
   * have changed since). Returns the 3 signatory id/type column pairs to
   * write, or throws `InvalidSignatoryAuthorityException` if a submitted id
   * doesn't match any current candidate. Slot 1 is only mandatory when at
   * least one candidate actually exists for this department — a
   * misconfigured/empty department must not block approval entirely.
   */
  private async resolveSignatoryColumns(
    id: string,
    tenantId: string,
    branchId: string,
    dto: ApproveReportDto,
  ): Promise<{
    signatoryAuthority1Id: string | null;
    signatoryAuthority1Type:
      | 'USER'
      | 'CONSULTANT_DOCTOR'
      | 'REPORTING_DOCTOR'
      | null;
    signatoryAuthority2Id: string | null;
    signatoryAuthority2Type:
      | 'USER'
      | 'CONSULTANT_DOCTOR'
      | 'REPORTING_DOCTOR'
      | null;
    signatoryAuthority3Id: string | null;
    signatoryAuthority3Type:
      | 'USER'
      | 'CONSULTANT_DOCTOR'
      | 'REPORTING_DOCTOR'
      | null;
  }> {
    const { candidates } = await this.getSignatoryCandidatesInternal(
      id,
      tenantId,
      branchId,
    );
    const byPersonId = new Map(candidates.map((c) => [c.personId, c]));

    const resolveSlot = (
      personId: string | undefined,
      required: boolean,
    ): {
      id: string | null;
      type: 'USER' | 'CONSULTANT_DOCTOR' | 'REPORTING_DOCTOR' | null;
    } => {
      if (!personId) {
        if (required) throw new InvalidSignatoryAuthorityException('(missing)');
        return { id: null, type: null };
      }
      const candidate = byPersonId.get(personId);
      if (!candidate || !candidate.resolvable) {
        throw new InvalidSignatoryAuthorityException(personId);
      }
      return { id: candidate.personId, type: candidate.type };
    };

    // Slot 1 is mandatory only when the department actually has ≥1 candidate;
    // an empty/misconfigured department must not block approval.
    const slot1 = resolveSlot(dto.signatoryAuthority1Id, candidates.length > 0);
    const slot2 = resolveSlot(dto.signatoryAuthority2Id, false);
    const slot3 = resolveSlot(dto.signatoryAuthority3Id, false);

    return {
      signatoryAuthority1Id: slot1.id,
      signatoryAuthority1Type: slot1.type,
      signatoryAuthority2Id: slot2.id,
      signatoryAuthority2Type: slot2.type,
      signatoryAuthority3Id: slot3.id,
      signatoryAuthority3Type: slot3.type,
    };
  }

  async approve(
    id: string,
    tenantId: string,
    branchId: string | null,
    actorId: string,
    dto: ApproveReportDto = {},
  ) {
    const activeBranchId = this.requireBranch(branchId);
    const report = await this.requireReport(id, tenantId, activeBranchId);
    this.assertTransition('approve', report.status);

    // SRS §5.4/§5.5: block approval while still deferred to a later Reporting
    // session (stamped by validate() when the result landed after cutoff).
    if (
      report.reportingDeferredUntil &&
      report.reportingDeferredUntil > new Date()
    ) {
      throw new ReportingWindowClosedException(report.reportingDeferredUntil);
    }

    const signatoryColumns = await this.resolveSignatoryColumns(
      id,
      tenantId,
      activeBranchId,
      dto,
    );

    // Freeze the Analytical-TAT snapshot at the approval instant, so analytics
    // stay accurate even if the test's TAT config later changes (hybrid
    // storage). Computed before the write so the tat* columns land in the same
    // update as approvedAt.
    //
    // Two flows (see NablTatCronService): a report the NABL cron has been
    // managing (`isNablTat`) is FINALIZED — its accumulated stopwatch is stopped
    // and re-banded, leaving tatStartAt as the cron set it. Every other report
    // (NABL branch that never started, or a non-NABL branch) uses the legacy
    // accepted→approved snapshot unchanged.
    const approvedAt = new Date();
    const tatData: Prisma.LabReportUpdateInput = report.isNablTat
      ? await this.tatService.buildNablFinalize(
          id,
          tenantId,
          activeBranchId,
          approvedAt,
        )
      : await (async () => {
          const s = await this.tatService.buildApprovalSnapshot(
            id,
            tenantId,
            activeBranchId,
            approvedAt,
          );
          return {
            tatStartAt: s.tatStartAt,
            tatNetMinutes: s.tatNetMinutes,
            tatMaxMinutes: s.tatMaxMinutes,
            tatBand: s.tatBand,
          };
        })();

    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.labReport.update({
        where: { id },
        data: {
          status: LabReportStatus.APPROVED,
          approvedAt,
          approvedBy: actorId,
          reportingDeferredUntil: null,
          ...tatData,
          ...signatoryColumns,
        },
      });
      if (dto.notes) {
        await tx.labReportNote.create({
          data: {
            tenantId,
            labReportId: id,
            category: 'TECH',
            body: dto.notes,
            createdBy: actorId,
          },
        });
      }
      await this.recordHistory(
        tx,
        tenantId,
        id,
        report.status,
        LabReportStatus.APPROVED,
        'approve',
        actorId,
        dto.notes,
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

    const updated = await this.prisma.withTenant(tenantId, async (tx) => {
      const u = await tx.labReport.update({
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
      return u;
    });
    // Fire-and-forget: "report ready" to the patient (email + in-app), resolved
    // via order item → order. Handled by ClinicalEventListener.
    void this.eventEmitter.emitAsync('lab-report.published', {
      tenantId,
      branchId,
      reportId: updated.id,
      orderItemId: updated.orderItemId,
    });
    return updated;
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
          // Re-run reopens the TAT clock (agreed behaviour): drop the frozen
          // snapshot so TAT recomputes live until the report is re-approved.
          tatStartAt: null,
          tatNetMinutes: null,
          tatMaxMinutes: null,
          tatBand: null,
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
          data: {
            tenantId,
            labReportId: id,
            category: 'LOCK',
            body: notes,
            createdBy: actorId,
          },
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
      data: {
        isLocked: false,
        lockedAt: null,
        lockedBy: null,
        lockNotes: null,
      },
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
  //
  // Bug fix: `LabReportNote.labReportId` ties every row to one specific test's
  // report, but LABORATORY.docx §4.1/§4.2 frame these 3 tabs as living under
  // the *order*-level header strip and being "visible to every technician who
  // opens the order" — not scoped to whichever single test they happened to
  // open. An order with multiple tests (multiple `LabReport`s) previously hid
  // a note added on Test A's tab from Test B's identical tab, confirmed live.
  // Fix: `createNote`/`findNotes` resolve the report's sibling `LabReport`s
  // (same `orderId`, via `orderItem.orderId`) and read/write across all of
  // them — the route/DTO contract (`POST/GET /lab-reports/:id/notes`) is
  // unchanged, `:id` just now means "this order" rather than "this report."
  // The other 9 `LabReportNoteCategory` values (Lock/Delta/Critical Alert/
  // etc.) are untouched — those are genuinely per-test action side-effects,
  // not this order-wide tab system, and keep their existing single-report
  // scoping (see PLAIN_NOTE_CATEGORIES's own doc comment).

  /** All `LabReport.id`s belonging to the same order as `id`, `id` included. */
  private async siblingReportIds(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<string[]> {
    const report = await this.prisma.labReport.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
      select: { orderItem: { select: { orderId: true } } },
    });
    if (!report) throw new LabReportNotFoundException(id);

    const siblings = await this.prisma.labReport.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        orderItem: { orderId: report.orderItem.orderId },
      },
      select: { id: true },
    });
    return siblings.map((s) => s.id);
  }

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
    const reportIds = await this.siblingReportIds(id, tenantId, activeBranchId);

    const rows = await this.prisma.labReportNote.findMany({
      where: {
        tenantId,
        labReportId: { in: reportIds },
        category: query.category
          ? query.category
          : { in: [...PLAIN_NOTE_CATEGORIES] },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Bug fix: `createdBy` is a logical Person.id (same unenforced-reference
    // pattern as LabReportHistory.actorId, see enrichActorNames) — the
    // Order/Sample/Tech Notes tabs were showing this raw UUID directly
    // instead of a human name. Reuses the same resolve-and-fall-back-to-raw-id
    // convention as `resolveActorNames` (Re-Run's "Re-Run By" column).
    const nameById = await resolveActorNames(
      this.prisma,
      rows.map((r) => r.createdBy),
    );
    return rows.map((r) => ({
      ...r,
      createdByName: nameById.get(r.createdBy) ?? r.createdBy,
    }));
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
