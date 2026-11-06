import { Injectable, Logger } from '@nestjs/common';
import {
  Branch,
  BranchStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BranchService } from '../branch/branch.service';
import { OrderService } from '../order/order.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { PdfReportTemplateType } from '../pdf-report-template/constants/pdf-report-template-types.constant';
import {
  OrderWithRelations,
  derivePaymentStatus,
} from '../order/entities/order.entity';
import {
  PublicOrderStatus,
  PublicOrderView,
  PublicTransaction,
} from './dto/public-order.dto';
import {
  PublicBillNotPrintableException,
  PublicOrderNotFoundException,
} from './exceptions/public.exceptions';

/** The QR Code Scan settings the public print paths need. */
interface PublicQrSettings {
  billPrintablePaymentStatuses: PaymentStatus[];
  billPrintTemplateId: string | null;
  reportPrintTemplateId: string | null;
}

/** Defaults when a branch has never saved QR Code Scan settings (mirrors the DB column defaults). */
const DEFAULT_QR_SETTINGS: PublicQrSettings = {
  billPrintablePaymentStatuses: [PaymentStatus.PAID],
  billPrintTemplateId: null,
  reportPrintTemplateId: null,
};

/** A validated public order plus the little extra the page needs. */
interface ValidatedPublicOrder {
  order: OrderWithRelations;
  branch: Branch;
  patientPhotoUrl: string | null;
}

/** Title-case a SCREAMING_SNAKE enum value, e.g. `PREFER_NOT_TO_SAY` → "Prefer Not To Say". */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Prisma `Decimal | number` → number. */
function num(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : Number(value);
}

/**
 * The "TAT Maximum" from a test/panel's master data as a display string, e.g.
 * `48 → HOURS` → "48 Hours", `1 → HOURS` → "1 Hour", `2 → DAYS` → "2 Days".
 * Returns null when either the value or the unit is missing.
 */
function formatTat(
  value: number | null | undefined,
  unit: string | null | undefined,
): string | null {
  if (value == null || !unit) return null;
  const label = titleCase(unit);
  const singular = value === 1 ? label.replace(/s$/, '') : label;
  return `${value} ${singular}`;
}

/**
 * Public (no-login) order access for the patient-facing order page
 * (`/public/:tenantId/:branchId/:orderId`). Every read re-validates the full
 * tenant → branch → order ownership chain so swapping a URL id can never reach
 * another tenant's/branch's data, and the tenant RLS context is set manually
 * (there is no JWT) via `PrismaService.runWithTenant`.
 */
@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantService: TenantService,
    private readonly branchService: BranchService,
    private readonly orderService: OrderService,
    private readonly labReportService: LabReportService,
    private readonly pdfReportTemplateService: PdfReportTemplateService,
    private readonly pdfTemplateConfigService: PdfTemplateConfigService,
  ) {}

  /**
   * Resolve a single, deterministic print template id for a document `type`
   * (e.g. `bill_print`) — the public endpoints have no template picker, so a
   * tenant with several active templates of a type would otherwise throw
   * `AMBIGUOUS_PRINT_TEMPLATE`. Prefers the tenant's configured "Configuration"
   * default (branch-first), then the first active template of the type.
   * @returns a template id, or null when the tenant has none active.
   */
  private async resolveTemplateId(
    tenantId: string,
    branchId: string,
    type: PdfReportTemplateType,
  ): Promise<string | null> {
    const configured =
      await this.pdfTemplateConfigService.resolveConfiguredTemplateId(
        tenantId,
        branchId,
        type,
      );
    if (configured) return configured;
    const { data } = await this.pdfReportTemplateService.findAllForTenant(
      tenantId,
      1,
      1,
      { type, status: 'ACTIVE' },
    );
    return data[0]?.id ?? null;
  }

  /**
   * Read the branch's QR Code Scan settings **read-only** (never creates the row,
   * since this runs on a public GET), falling back to the column defaults when the
   * branch has none yet. Must run inside the tenant RLS context.
   */
  private async readQrSettings(
    tenantId: string,
    branchId: string,
  ): Promise<PublicQrSettings> {
    const row = await this.prisma.qrCodeScanSetting.findUnique({
      where: { tenantId_branchId: { tenantId, branchId } },
      select: {
        billPrintablePaymentStatuses: true,
        billPrintTemplateId: true,
        reportPrintTemplateId: true,
      },
    });
    return row ?? DEFAULT_QR_SETTINGS;
  }

  /**
   * Validate the tenant → branch → order chain and load the order under the
   * tenant's RLS context. Throws a single generic 404 for every failure so an
   * unauthenticated caller cannot tell which id was wrong.
   *
   * @throws PublicOrderNotFoundException on any missing/inactive/mismatched link
   */
  private async loadValidatedOrder(
    tenantId: string,
    branchId: string,
    orderId: string,
  ): Promise<ValidatedPublicOrder> {
    const notFound = (reason: string): never => {
      // Logged (with the real reason) but never returned to the client.
      this.logger.warn(
        `Public order access denied: ${reason} (tenant=${tenantId} branch=${branchId} order=${orderId})`,
      );
      throw new PublicOrderNotFoundException(
        tenantId,
        branchId,
        orderId,
        reason,
      );
    };

    // Tenant is platform-level (no RLS) — read it first, require it active.
    const tenant = await this.tenantService
      .findById(tenantId)
      .catch(() => null);
    if (!tenant) return notFound('tenant-missing');
    if (!tenant.isActive) return notFound('tenant-inactive');

    // Branch + order are tenant-scoped (RLS) — run them inside the tenant
    // context so RLS admits exactly this tenant's rows.
    return this.prisma.runWithTenant(tenantId, async () => {
      const branch = await this.branchService
        .findById(branchId, tenantId)
        .catch(() => null);
      if (!branch) return notFound('branch-missing');
      if (branch.status !== BranchStatus.ACTIVE) {
        return notFound('branch-inactive');
      }

      const order = await this.orderService
        .findById(orderId, tenantId)
        .catch(() => null);
      if (!order) return notFound('order-missing');
      if (order.branchId !== branchId) return notFound('order-branch-mismatch');
      if (order.status !== OrderStatus.ORDER)
        return notFound('order-not-final');

      // Photo lives on `Patient.photoUrl` (not in the order include).
      const patient = await this.prisma.patient.findFirst({
        where: { id: order.patientId, tenantId, deletedAt: null },
        select: { photoUrl: true },
      });

      return {
        order,
        branch,
        patientPhotoUrl: patient?.photoUrl ?? null,
      };
    });
  }

  /**
   * The public order page payload: patient identity, order header, billing,
   * transaction history, report availability, and the server-resolved action
   * gating from the branch's QR Code Scan Settings.
   * @throws PublicOrderNotFoundException when the chain does not validate
   */
  async getOrder(
    tenantId: string,
    branchId: string,
    orderId: string,
  ): Promise<PublicOrderView> {
    const { order, branch, patientPhotoUrl } = await this.loadValidatedOrder(
      tenantId,
      branchId,
      orderId,
    );
    const qr = await this.prisma.runWithTenant(tenantId, () =>
      this.readQrSettings(tenantId, branchId),
    );
    // The tenant's display locale — so the page renders payment timestamps (stored
    // in UTC) and amounts in the business's own time zone / currency, not the
    // server's or the patient device's. `getLocale` is platform-level (no RLS).
    const locale = await this.tenantService.getLocale(tenantId);
    return this.toView(order, branch, patientPhotoUrl, qr, locale);
  }

  /**
   * Render the patient bill PDF for a public order, honouring the branch's QR
   * Code Scan Settings: the bill is only printable when its payment status is in
   * `billPrintablePaymentStatuses`, and the configured `billPrintTemplateId` is
   * used (falling back to the tenant's resolved bill template). Ownership is
   * re-validated here.
   * @returns the rendered PDF bytes + a patient-friendly download filename
   * @throws PublicBillNotPrintableException when the status is not allowed
   */
  async getBillPdf(
    tenantId: string,
    branchId: string,
    orderId: string,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const { order } = await this.loadValidatedOrder(
      tenantId,
      branchId,
      orderId,
    );
    const status = derivePaymentStatus(order.netAmount, order.paidAmount);
    return this.prisma.runWithTenant(tenantId, async () => {
      const qr = await this.readQrSettings(tenantId, branchId);
      if (!qr.billPrintablePaymentStatuses.includes(status)) {
        throw new PublicBillNotPrintableException(orderId, status);
      }
      // Prefer the branch's configured Bill Print template; else resolve a single
      // active `bill_print` template so a tenant with several doesn't 409.
      const templateId =
        qr.billPrintTemplateId ??
        (await this.resolveTemplateId(tenantId, branchId, 'bill_print')) ??
        undefined;
      const pdf = await this.orderService.print(
        orderId,
        tenantId,
        'bill_print',
        templateId,
      );
      return { pdf, fileName: `bill-${order.orderCode}.pdf` };
    });
  }

  /**
   * Render the order's PUBLISHED lab reports as one merged PDF, reusing the staff
   * all-reports pipeline with the PUBLISHED-only filter on, and the branch's
   * configured `reportPrintTemplateId` when set. Ownership is re-validated here;
   * 404 when the order has no published report yet.
   * @returns the merged report PDF bytes + a patient-friendly download filename
   * @throws PublicOrderNotFoundException when nothing is published
   */
  async getReportPdf(
    tenantId: string,
    branchId: string,
    orderId: string,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const { order } = await this.loadValidatedOrder(
      tenantId,
      branchId,
      orderId,
    );
    try {
      return await this.prisma.runWithTenant(tenantId, async () => {
        const qr = await this.readQrSettings(tenantId, branchId);
        const pdf = await this.labReportService.printAllForOrder(
          orderId,
          tenantId,
          branchId,
          qr.reportPrintTemplateId ?? undefined,
          undefined,
          undefined,
          true, // publishedOnly
        );
        return { pdf, fileName: `report-${order.orderCode}.pdf` };
      });
    } catch (err) {
      if (err instanceof PublicOrderNotFoundException) throw err;
      // No published reports (or none this caller may read) → treat as not found
      // rather than leaking the internal "no reports" exception.
      throw new PublicOrderNotFoundException(
        tenantId,
        branchId,
        orderId,
        'no-published-reports',
      );
    }
  }

  /** The order's one-line branch address, from the populated address parts. */
  private branchAddress(branch: Branch): string | null {
    const parts = [
      branch.addressLine,
      branch.city,
      branch.state,
      branch.pincode,
      branch.country,
    ]
      .map((p) => p?.trim())
      .filter((p): p is string => Boolean(p));
    return parts.length > 0 ? parts.join(', ') : null;
  }

  /** The patient's display age, e.g. "45 Years" / "6 Months" (null when unknown). */
  private patientAge(
    age: number | null,
    ageType: string | null,
  ): string | null {
    if (age == null) return null;
    const unit = ageType ? titleCase(ageType) : 'Years';
    return `${age} ${unit}`;
  }

  /** Patient-facing report readiness, from the order's published report coverage. */
  private deriveOrderStatus(order: OrderWithRelations): PublicOrderStatus {
    const reports = order.items.flatMap((it) => it.labReports);
    if (reports.length === 0) return 'IN_PROGRESS';
    const published = reports.filter((r) => r.status === 'PUBLISHED').length;
    if (published === 0) return 'IN_PROGRESS';
    if (published >= reports.length) return 'READY';
    return 'PARTIALLY_READY';
  }

  /** The bill's payment + refund history, oldest first. */
  private toTransactions(order: OrderWithRelations): PublicTransaction[] {
    return (
      order.payments
        .map((p) => {
          const isRefund = p.entryType === 'REFUND';
          return {
            type: p.entryType,
            amount: isRefund ? num(p.refundAmount) : num(p.paidAmount),
            paymentMode: p.paymentMode,
            paymentDate: (p.paymentDate ?? p.createdAt)?.toISOString() ?? null,
            reference: p.reference ?? null,
          };
        })
        // Drop zeroed ledger rows (e.g. a "no bill" order's forced-PAID row) so the
        // history only shows real money movements.
        .filter((t) => t.amount > 0)
    );
  }

  /** Map a validated order to the safe public projection. */
  private toView(
    order: OrderWithRelations,
    branch: Branch,
    patientPhotoUrl: string | null,
    qr: PublicQrSettings,
    locale: {
      timezone: string;
      currency: string;
      dateFormat: string;
      timeFormat: string;
    },
  ): PublicOrderView {
    const p = order.patient;
    const name = [p.firstName, p.middleName, p.lastName]
      .filter((part) => part && part.trim().length > 0)
      .join(' ')
      .trim();

    const doctorName = order.referredByDoctor
      ? [order.referredByDoctor.firstName, order.referredByDoctor.lastName]
          .filter((part) => part && part.trim().length > 0)
          .join(' ')
          .trim() || null
      : null;

    const items = order.items.map((it) => {
      // "TAT Maximum" comes from whichever catalogue entry backs the line (test
      // or panel); direct free-text items have no catalogue TAT.
      const catalogue = it.branchLabTest ?? it.branchLabPanel ?? null;
      return {
        name:
          it.branchLabTest?.testName ??
          it.branchLabPanel?.panelName ??
          it.direct ??
          'Test',
        // There is no per-line quantity in the schema — each line is one test/panel.
        quantity: 1,
        unitPrice: num(it.unitPrice),
        tat: formatTat(catalogue?.tatMaxValue, catalogue?.tatMaxUnit),
      };
    });

    const gross = order.grossAmount;
    const discount = order.discountAmount;
    const net = order.netAmount;
    const paid = order.paidAmount;
    const outstanding = Math.max(0, net - paid);
    const refunded = order.payments.reduce(
      (s, row) => s + num(row.refundAmount),
      0,
    );
    const status = derivePaymentStatus(net, paid);

    const publishedReports = order.items
      .flatMap((it) => it.labReports)
      .filter((r) => r.status === 'PUBLISHED');
    const hasPublishedReports = publishedReports.length > 0;

    return {
      patient: {
        name,
        age: this.patientAge(p.age, p.ageType),
        gender: p.gender ? titleCase(p.gender) : null,
        umId: p.umId ?? null,
        photoUrl: patientPhotoUrl,
      },
      order: {
        orderCode: order.orderCode,
        externalOrderId: order.externalOrderId ?? null,
        orderDate: order.orderDate.toISOString().slice(0, 10),
        orderTime: order.orderTime ?? null,
        status: this.deriveOrderStatus(order),
        doctorName,
        branchName: branch.name,
        branchAddress: this.branchAddress(branch),
      },
      items,
      billing: {
        billId: order.orderCode,
        status,
        gross,
        discount,
        net,
        paid,
        outstanding,
        refunded,
      },
      transactions: this.toTransactions(order),
      locale: {
        timeZone: locale.timezone,
        currency: locale.currency,
        dateFormat: locale.dateFormat,
        timeFormat: locale.timeFormat,
      },
      reports: {
        hasPublishedReports,
        publishedCount: publishedReports.length,
      },
      actions: {
        isBillPrintable: qr.billPrintablePaymentStatuses.includes(status),
        isReportPrintable: hasPublishedReports,
      },
    };
  }
}
