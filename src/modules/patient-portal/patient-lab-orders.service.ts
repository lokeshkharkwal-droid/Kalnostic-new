import { Injectable, Logger } from '@nestjs/common';
import { LabReportStatus, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaginatedResult } from '../../common/dto/response.dto';
import { TenantService } from '../tenant/tenant.service';
import { LabReportService } from '../lab-report/lab-report.service';
import {
  ActiveBranchRequiredException,
  LabReportNotFoundException,
  LabReportPrintItemRemovedException,
  LabReportPrintOrderCancelledException,
  NoActivePrintTemplateException,
  OrderReportsNotFoundException,
} from '../lab-report/exceptions/lab-report.exceptions';
import {
  ReferralReportCreditDaysException,
  ReferralReportCreditLimitException,
} from '../referral-credit/referral-credit.exceptions';
import type { ListPatientLabOrdersQueryDto } from './dto/list-patient-lab-orders-query.dto';
import type {
  PatientLabOrderDetail,
  PatientLabOrderListItem,
  PatientLabOrderStatus,
  PatientLabOrderTestRow,
  PatientLabReportStatus,
} from './entities/patient-lab-order.entity';
import {
  PatientLabOrderNotFoundException,
  PatientReportNotAvailableException,
} from './exceptions/patient-portal.exceptions';
import { PatientScopeService } from './patient-scope.service';
import { composePatientName } from './utils/compose-patient-name.util';

/** Statuses at which a test line counts as "finished" testing. */
const FINISHED_STATUSES: ReadonlySet<LabReportStatus> = new Set([
  LabReportStatus.APPROVED,
  LabReportStatus.PUBLISHED,
]);

/** The only report status a patient may ever see or download. */
const PUBLISHED_ONLY: ReadonlySet<LabReportStatus> = new Set([
  LabReportStatus.PUBLISHED,
]);

/** Orders a patient can see: placed orders and cancelled ones (never drafts/quotes/appointments). */
const VISIBLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.ORDER,
  OrderStatus.CANCELLED,
];

const DEFAULT_LIMIT = 10;

/** What a list row needs from each order line (test / panel / free-text). */
const LINE_SELECT = {
  id: true,
  direct: true,
  selectedMemberBranchLabTestIds: true,
  branchLabTest: { select: { testName: true, testDisplayName: true } },
  branchLabPanel: { select: { id: true, panelName: true } },
  labReports: {
    where: { deletedAt: null },
    select: {
      id: true,
      status: true,
      memberBranchLabTestId: true,
      publishedAt: true,
    },
  },
} satisfies Prisma.OrderItemSelect;

const LIST_SELECT = {
  id: true,
  orderCode: true,
  externalOrderId: true,
  orderDate: true,
  status: true,
  billStatus: true,
  patientId: true,
  patient: {
    select: {
      firstName: true,
      middleName: true,
      lastName: true,
    },
  },
  branch: { select: { name: true, city: true } },
  items: { where: { deletedAt: null }, select: LINE_SELECT },
} satisfies Prisma.OrderSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  orderTime: true,
  billId: true,
  branchId: true,
  referredByDoctor: { select: { firstName: true, lastName: true } },
} satisfies Prisma.OrderSelect;

type ListOrderRow = Prisma.OrderGetPayload<{ select: typeof LIST_SELECT }>;
type DetailOrderRow = Prisma.OrderGetPayload<{ select: typeof DETAIL_SELECT }>;
type OrderLine = ListOrderRow['items'][number];

/** A panel's member tests, as the patient sees them. */
interface PanelMember {
  id: string;
  name: string;
}

/**
 * Read-only lab orders for the patient portal: the list, the detail popup and
 * the PUBLISHED-only report PDFs.
 *
 * Every read is scoped by the session's tenant and the patient ids from
 * {@link PatientScopeService} (own record + linked family members); the order
 * id in a URL is never trusted on its own. A patient only ever sees the lab's
 * `PUBLISHED` reports — nothing else is exposed, not even the internal status
 * of an unpublished report.
 */
@Injectable()
export class PatientLabOrdersService {
  private readonly logger = new Logger(PatientLabOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PatientScopeService,
    private readonly tenantService: TenantService,
    private readonly labReportService: LabReportService,
  ) {}

  // ── List ───────────────────────────────────────────────────────────────────

  /**
   * One page of the patient's lab orders (orders that carry a diagnostics /
   * lab section), newest first, across every branch of the session's tenant.
   * @param tenantId active tenant (from the patient JWT)
   * @param personId the authenticated platform person (from the patient JWT)
   * @param query paging + optional family-member / search / date filters
   * @returns `{ data, total, page, limit }`
   */
  async list(
    tenantId: string,
    personId: string,
    query: ListPatientLabOrdersQueryDto,
  ): Promise<PaginatedResult<PatientLabOrderListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const patientIds = await this.scope.resolveScopedPatientIds(
      tenantId,
      personId,
      query.patientId,
    );
    if (patientIds.length === 0) {
      return { data: [], total: 0, page, limit };
    }

    const where = this.buildListWhere(tenantId, patientIds, query);
    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const members = await this.loadPanelMembers(
      tenantId,
      orders.flatMap((o) => o.items),
    );
    return {
      data: orders.map((o) => this.toListItem(o, members)),
      total,
      page,
      limit,
    };
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  /**
   * One lab order with its per-test report rows.
   * @param tenantId active tenant (from the patient JWT)
   * @param personId the authenticated platform person (from the patient JWT)
   * @param orderId the order id from the URL (re-checked against the scope)
   * @throws PatientLabOrderNotFoundException when it is not a lab order in the patient's scope
   */
  async getDetail(
    tenantId: string,
    personId: string,
    orderId: string,
  ): Promise<PatientLabOrderDetail> {
    const order = await this.loadScopedOrder(tenantId, personId, orderId);
    const members = await this.loadPanelMembers(tenantId, order.items);
    const locale = await this.tenantService.getLocale(tenantId);
    const canDownload = order.status !== OrderStatus.CANCELLED;

    const doctor = order.referredByDoctor;
    const referringDoctorName = doctor
      ? [doctor.firstName, doctor.lastName]
          .filter((p) => p && p.trim().length > 0)
          .join(' ')
          .trim() || null
      : null;

    return {
      ...this.toListItem(order, members),
      orderTime: order.orderTime ?? null,
      referringDoctorName,
      billNo: order.billId ?? null,
      testRows: order.items.flatMap((line) =>
        this.toTestRows(line, members, canDownload),
      ),
      locale: {
        timeZone: locale.timezone,
        dateFormat: locale.dateFormat,
        timeFormat: locale.timeFormat,
      },
    };
  }

  // ── PDFs ───────────────────────────────────────────────────────────────────

  /**
   * All of the order's PUBLISHED reports as one merged PDF.
   * @param tenantId active tenant (from the patient JWT)
   * @param personId the authenticated platform person (from the patient JWT)
   * @param orderId the order id from the URL (re-checked against the scope)
   * @returns the PDF bytes and a download file name
   * @throws PatientLabOrderNotFoundException when the order is not in scope
   * @throws PatientReportNotAvailableException when nothing is published, the
   *   order is cancelled, or the lab's rules (e.g. a referrer credit limit)
   *   withhold the reports — always with the same neutral message
   */
  async getAllReportsPdf(
    tenantId: string,
    personId: string,
    orderId: string,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const order = await this.loadScopedOrder(tenantId, personId, orderId);
    if (order.status === OrderStatus.CANCELLED) {
      throw new PatientReportNotAvailableException('order-cancelled', {
        orderId,
      });
    }
    const branchId = order.branchId;
    if (!branchId) {
      throw new PatientReportNotAvailableException('order-has-no-branch', {
        orderId,
      });
    }
    const published = order.items
      .flatMap((l) => l.labReports)
      .filter((r) => r.status === LabReportStatus.PUBLISHED).length;
    if (published === 0) {
      throw new PatientReportNotAvailableException(
        'nothing-published',
        { orderId },
        404,
      );
    }

    const qr = await this.prisma.qrCodeScanSetting.findUnique({
      where: { tenantId_branchId: { tenantId, branchId } },
      select: { reportPrintTemplateId: true },
    });
    const pdf = await this.neutralOnFailure(orderId, () =>
      this.labReportService.printAllForOrder(
        orderId,
        tenantId,
        branchId,
        qr?.reportPrintTemplateId ?? undefined,
        undefined,
        undefined,
        true, // publishedOnly
      ),
    );
    return { pdf, fileName: `reports-${order.orderCode}.pdf` };
  }

  /**
   * One PUBLISHED report as a PDF. The report must belong to this order, which
   * must belong to the patient's scope — a report id alone is never enough.
   * @param tenantId active tenant (from the patient JWT)
   * @param personId the authenticated platform person (from the patient JWT)
   * @param orderId the order id from the URL (re-checked against the scope)
   * @param reportId the report id from the URL (must be PUBLISHED and on this order)
   * @returns the PDF bytes and a download file name
   * @throws PatientLabOrderNotFoundException when the order is not in scope
   * @throws PatientReportNotAvailableException when the report is not published, not on this order, or withheld
   */
  async getReportPdf(
    tenantId: string,
    personId: string,
    orderId: string,
    reportId: string,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const order = await this.loadScopedOrder(tenantId, personId, orderId);
    if (order.status === OrderStatus.CANCELLED) {
      throw new PatientReportNotAvailableException('order-cancelled', {
        orderId,
      });
    }
    const branchId = order.branchId;
    if (!branchId) {
      throw new PatientReportNotAvailableException('order-has-no-branch', {
        orderId,
      });
    }
    const report = await this.prisma.labReport.findFirst({
      where: {
        id: reportId,
        tenantId,
        deletedAt: null,
        status: LabReportStatus.PUBLISHED,
        orderItem: { orderId: order.id, deletedAt: null },
      },
      select: { id: true },
    });
    if (!report) {
      throw new PatientReportNotAvailableException(
        'report-not-published-or-not-on-order',
        { orderId, reportId },
        404,
      );
    }

    const pdf = await this.neutralOnFailure(orderId, () =>
      this.labReportService.print(
        report.id,
        tenantId,
        branchId,
        undefined,
        'lab_report',
        true,
        false,
      ),
    );
    return { pdf, fileName: `report-${order.orderCode}-${report.id}.pdf` };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** The patient's lab-order filter: tenant + scoped patients + diagnostics section. */
  private buildListWhere(
    tenantId: string,
    patientIds: string[],
    query: ListPatientLabOrdersQueryDto,
  ): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {
      tenantId,
      deletedAt: null,
      status: { in: VISIBLE_ORDER_STATUSES },
      patientId: { in: patientIds },
      diagnostics: { is: { deletedAt: null } },
    };
    if (query.dateFrom || query.dateTo) {
      where.orderDate = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    const search = query.search;
    if (search) {
      const contains = { contains: search, mode: 'insensitive' as const };
      where.OR = [
        { orderCode: contains },
        { externalOrderId: contains },
        {
          items: {
            some: {
              deletedAt: null,
              OR: [
                { direct: contains },
                {
                  branchLabTest: {
                    is: {
                      OR: [
                        { testName: contains },
                        { testDisplayName: contains },
                      ],
                    },
                  },
                },
                { branchLabPanel: { is: { panelName: contains } } },
              ],
            },
          },
        },
      ];
    }
    return where;
  }

  /**
   * Load one order if — and only if — it is a lab order of a patient in the
   * session's scope. Every other case is the same generic 404.
   */
  private async loadScopedOrder(
    tenantId: string,
    personId: string,
    orderId: string,
  ): Promise<DetailOrderRow> {
    const patientIds = await this.scope.resolveScopedPatientIds(
      tenantId,
      personId,
    );
    const order =
      patientIds.length === 0
        ? null
        : await this.prisma.order.findFirst({
            where: {
              id: orderId,
              tenantId,
              deletedAt: null,
              status: { in: VISIBLE_ORDER_STATUSES },
              patientId: { in: patientIds },
              diagnostics: { is: { deletedAt: null } },
            },
            select: DETAIL_SELECT,
          });
    if (!order) {
      throw new PatientLabOrderNotFoundException(orderId);
    }
    return order;
  }

  /**
   * The member tests of every panel line, in the panel's own order, keyed by
   * panel id. A report exists per member test only once its sample is accepted,
   * so the panel's members — not the reports — define what the order expects.
   */
  private async loadPanelMembers(
    tenantId: string,
    lines: OrderLine[],
  ): Promise<Map<string, PanelMember[]>> {
    const panelIds = [
      ...new Set(
        lines
          .map((l) => l.branchLabPanel?.id)
          .filter((id): id is string => !!id),
      ),
    ];
    const result = new Map<string, PanelMember[]>();
    if (panelIds.length === 0) {
      return result;
    }
    const links = await this.prisma.branchLabPanelTest.findMany({
      where: { tenantId, branchLabPanelId: { in: panelIds }, deletedAt: null },
      select: { branchLabPanelId: true, branchLabTestId: true },
      orderBy: { sortOrder: 'asc' },
    });
    const tests = await this.prisma.branchLabTest.findMany({
      where: {
        tenantId,
        id: { in: [...new Set(links.map((l) => l.branchLabTestId))] },
        deletedAt: null,
      },
      select: { id: true, testName: true, testDisplayName: true },
    });
    const byId = new Map(tests.map((t) => [t.id, t]));
    for (const link of links) {
      const test = byId.get(link.branchLabTestId);
      if (!test) continue;
      const list = result.get(link.branchLabPanelId) ?? [];
      list.push({ id: test.id, name: test.testDisplayName ?? test.testName });
      result.set(link.branchLabPanelId, list);
    }
    return result;
  }

  /** The member tests a panel line really runs (the chosen subset, or all). */
  private expectedMembers(
    line: OrderLine,
    members: Map<string, PanelMember[]>,
  ): PanelMember[] | null {
    if (!line.branchLabPanel) return null;
    const all = members.get(line.branchLabPanel.id) ?? [];
    const chosen = line.selectedMemberBranchLabTestIds;
    return chosen.length > 0 ? all.filter((m) => chosen.includes(m.id)) : all;
  }

  /** The name the patient sees for an order line. */
  private lineName(line: OrderLine): string {
    return (
      line.branchLabPanel?.panelName ??
      line.branchLabTest?.testDisplayName ??
      line.branchLabTest?.testName ??
      line.direct ??
      'Test'
    );
  }

  /**
   * Whether a line is done: every report it expects exists and sits in one of
   * `accepted`. A line with no report yet is never done (a report only exists
   * once its sample is accepted).
   */
  private isLineDone(
    line: OrderLine,
    members: PanelMember[] | null,
    accepted: ReadonlySet<LabReportStatus>,
  ): boolean {
    const reports = line.labReports;
    const hasWholePanelReport = reports.some(
      (r) => r.memberBranchLabTestId === null,
    );
    if (members && members.length > 0 && !hasWholePanelReport) {
      return members.every((m) =>
        reports.some(
          (r) => r.memberBranchLabTestId === m.id && accepted.has(r.status),
        ),
      );
    }
    return reports.length > 0 && reports.every((r) => accepted.has(r.status));
  }

  /** Derive the patient-facing statuses for an order from its lines. */
  private deriveProgress(
    order: ListOrderRow,
    members: Map<string, PanelMember[]>,
  ): {
    status: PatientLabOrderStatus;
    reportStatus: PatientLabReportStatus;
    publishedReportCount: number;
  } {
    const lines = order.items;
    const total = lines.length;
    let finished = 0;
    let published = 0;
    for (const line of lines) {
      const expected = this.expectedMembers(line, members);
      if (this.isLineDone(line, expected, FINISHED_STATUSES)) finished += 1;
      if (this.isLineDone(line, expected, PUBLISHED_ONLY)) published += 1;
    }
    const publishedReportCount = lines
      .flatMap((l) => l.labReports)
      .filter((r) => r.status === LabReportStatus.PUBLISHED).length;
    const anyReport = lines.some((l) => l.labReports.length > 0);

    let status: PatientLabOrderStatus;
    if (order.status === OrderStatus.CANCELLED) status = 'CANCELLED';
    else if (total > 0 && finished === total) status = 'COMPLETE';
    else if (finished > 0) status = 'PARTIALLY_COMPLETE';
    else if (anyReport) status = 'IN_PROGRESS';
    else status = 'PENDING';

    let reportStatus: PatientLabReportStatus;
    if (total > 0 && published === total) reportStatus = 'PUBLISHED';
    else if (publishedReportCount > 0) reportStatus = 'PARTIALLY_PUBLISHED';
    else reportStatus = 'NOT_PUBLISHED';

    return { status, reportStatus, publishedReportCount };
  }

  /** Map an order row to a list item. */
  private toListItem(
    order: ListOrderRow,
    members: Map<string, PanelMember[]>,
  ): PatientLabOrderListItem {
    const progress = this.deriveProgress(order, members);
    return {
      orderId: order.id,
      orderNo: order.externalOrderId ?? order.orderCode,
      orderDate: order.orderDate.toISOString().slice(0, 10),
      patientId: order.patientId,
      patientName: composePatientName(order.patient),
      branchName: order.branch?.name ?? null,
      branchCity: order.branch?.city ?? null,
      tests: order.items.map((l) => this.lineName(l)),
      status: progress.status,
      reportStatus: progress.reportStatus,
      publishedReportCount: progress.publishedReportCount,
      canDownloadReports:
        order.status !== OrderStatus.CANCELLED &&
        progress.publishedReportCount > 0,
      billStatus: order.billStatus,
    };
  }

  /** The per-test rows for one order line (a panel expands into its members). */
  private toTestRows(
    line: OrderLine,
    members: Map<string, PanelMember[]>,
    canDownload: boolean,
  ): PatientLabOrderTestRow[] {
    const row = (
      testName: string,
      groupName: string | null,
      report?: OrderLine['labReports'][number],
    ): PatientLabOrderTestRow => {
      const isPublished = report?.status === LabReportStatus.PUBLISHED;
      return {
        reportId: isPublished && canDownload && report ? report.id : null,
        testName,
        groupName,
        isPublished,
        publishedAt:
          isPublished && report?.publishedAt
            ? report.publishedAt.toISOString()
            : null,
      };
    };

    const expected = this.expectedMembers(line, members);
    const name = this.lineName(line);
    const hasWholePanelReport = line.labReports.some(
      (r) => r.memberBranchLabTestId === null,
    );

    if (expected && expected.length > 0 && !hasWholePanelReport) {
      return expected.map((m) =>
        row(
          m.name,
          name,
          line.labReports.find((r) => r.memberBranchLabTestId === m.id),
        ),
      );
    }
    if (line.labReports.length === 0) {
      return [row(name, null)];
    }
    return line.labReports.map((r) => row(name, null, r));
  }

  /**
   * Run a report render and turn every "the lab's rules or setup stop this"
   * failure into the one neutral patient message. Anything unexpected is
   * rethrown untouched (it is a real server error, not a patient-facing rule).
   */
  private async neutralOnFailure<T>(
    orderId: string,
    render: () => Promise<T>,
  ): Promise<T> {
    try {
      return await render();
    } catch (err) {
      if (
        err instanceof ReferralReportCreditLimitException ||
        err instanceof ReferralReportCreditDaysException
      ) {
        // The referrer's credit restriction. The error carries the lab's private
        // figures, so only a neutral message is returned.
        this.logger.warn(`Report withheld by credit rule (order ${orderId})`);
        throw new PatientReportNotAvailableException('credit-restriction', {
          orderId,
          code: err.errorCode,
        });
      }
      if (
        err instanceof NoActivePrintTemplateException ||
        err instanceof ActiveBranchRequiredException
      ) {
        this.logger.error(
          `Patient report cannot render (order ${orderId}): ${err.errorCode}`,
        );
        throw new PatientReportNotAvailableException(
          'render-setup',
          { orderId, code: err.errorCode },
          503,
        );
      }
      if (
        err instanceof OrderReportsNotFoundException ||
        err instanceof LabReportNotFoundException ||
        err instanceof LabReportPrintOrderCancelledException ||
        err instanceof LabReportPrintItemRemovedException
      ) {
        throw new PatientReportNotAvailableException(
          'nothing-to-print',
          { orderId, code: err.errorCode },
          404,
        );
      }
      throw err;
    }
  }
}
