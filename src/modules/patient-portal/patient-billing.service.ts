import { Injectable } from '@nestjs/common';
import {
  BillStatus,
  OrderStatus,
  PaymentEntryType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '../../common/exceptions/kaltros.exception';
import { OrderService } from '../order/order.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { PatientPortalService } from './patient-portal.service';
import {
  BILL_STATUSES,
  BILL_STATUS_LABELS,
  composeName,
  firstNonBlank,
  paymentModeLabel,
  round2,
} from './patient-portal.util';
import type {
  PatientBillDetail,
  PatientBillItem,
  PatientBillRow,
  PatientBillTransaction,
} from './entities/patient-bill.entity';

/** The bill print-template slot — "Lab Order Bill". */
const BILL_TEMPLATE_TYPE = 'bill_print';

/**
 * Patient-facing billing. **Person-scoped, cross-business:** lists the patient's
 * bills across EVERY business (tenant) they belong to — and every branch within
 * each — and details/prints one, re-entering the business the bill belongs to
 * (`tenantId` from the list row). For each business the reads run inside that
 * tenant's RLS context (`runWithTenant`) and still filter `{ tenantId,
 * patientId }`, so ownership is enforced twice — a patient can never reach another
 * patient's bill by changing an id. The bill PDF reuses the exact `bill_print`
 * template + order rollups the staff `/registration/billing` page uses, so the
 * numbers never diverge.
 */
@Injectable()
export class PatientBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly pdfTemplateConfigService: PdfTemplateConfigService,
    private readonly patientPortal: PatientPortalService,
  ) {}

  /** Every patient record the person holds in the tenant (all branches). */
  private async resolvePatientIds(
    tenantId: string,
    personId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.patient.findMany({
      where: { tenantId, personId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** The list `where` for one tenant (tenantId kept for defence-in-depth + no-RLS). */
  private buildListWhere(
    tenantId: string,
    patientIds: string[],
    params: { dateFrom?: string; dateTo?: string; billStatus?: BillStatus },
  ): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {
      tenantId,
      patientId: { in: patientIds },
      deletedAt: null,
      status: { in: BILL_STATUSES },
      // Hide appointment-only orders with nothing paid (keyed on paid amount, not
      // paymentStatus) — they become bills only once a payment is collected.
      OR: [
        { status: { not: OrderStatus.APPOINTMENT } },
        { paidAmount: { gt: 0 } },
      ],
    };
    if (params.billStatus) where.billStatus = params.billStatus;
    if (params.dateFrom || params.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (params.dateFrom) createdAt.gte = new Date(params.dateFrom);
      if (params.dateTo) {
        const end = new Date(params.dateTo);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
      where.createdAt = createdAt;
    }
    return where;
  }

  /**
   * Paginated bill list for the patient, consolidated across every business they
   * belong to (and every branch within each). Server-side filters: date range,
   * business (`tenantId`), bill status. Appointment orders with nothing collected
   * are hidden (they're not yet real bills). Each business is queried for its
   * newest `page × limit` rows, merged, sorted by date desc and sliced to the
   * page; the total is the sum of per-business counts.
   */
  async listBills(
    personId: string,
    params: {
      dateFrom?: string;
      dateTo?: string;
      tenantId?: string;
      billStatus?: BillStatus;
      page: number;
      limit: number;
    },
  ): Promise<{
    data: PatientBillRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const enrolled = await this.patientPortal.getEnrolledTenants(personId);
    // Optional "Business" filter — narrow to one enrolled tenant when supplied.
    const tenants = params.tenantId
      ? enrolled.filter((t) => t.tenantId === params.tenantId)
      : enrolled;
    if (tenants.length === 0) {
      return { data: [], total: 0, page: params.page, limit: params.limit };
    }

    const windowSize = params.page * params.limit;
    const perTenant = await Promise.all(
      tenants.map((t) =>
        this.prisma.runWithTenant(t.tenantId, async () => {
          const patientIds = await this.resolvePatientIds(t.tenantId, personId);
          if (patientIds.length === 0) {
            return { rows: [] as PatientBillRow[], count: 0 };
          }
          const where = this.buildListWhere(t.tenantId, patientIds, params);
          const [rows, count] = await Promise.all([
            this.prisma.order.findMany({
              where,
              orderBy: { createdAt: 'desc' },
              take: windowSize,
              select: {
                id: true,
                orderCode: true,
                billId: true,
                createdAt: true,
                status: true,
                billStatus: true,
                netAmount: true,
                paidAmount: true,
                balanceAmount: true,
                branch: { select: { name: true } },
                patient: {
                  select: {
                    salutation: true,
                    firstName: true,
                    middleName: true,
                    lastName: true,
                  },
                },
              },
            }),
            this.prisma.order.count({ where }),
          ]);
          const mapped: PatientBillRow[] = rows.map((o) => ({
            orderId: o.id,
            orderCode: o.orderCode,
            billNumber: o.billId ?? o.orderCode,
            patientName: composeName(o.patient),
            orderDate: o.createdAt.toISOString(),
            branchName: o.branch?.name ?? null,
            billStatus: o.billStatus,
            billStatusLabel: BILL_STATUS_LABELS[o.billStatus],
            netAmount: o.netAmount,
            paidAmount: o.paidAmount,
            balanceAmount: o.balanceAmount,
            tenantId: t.tenantId,
            tenantName: t.tenantName,
          }));
          return { rows: mapped, count };
        }),
      ),
    );

    const all = perTenant
      .flatMap((r) => r.rows)
      .sort(
        (a, b) =>
          new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime(),
      );
    const total = perTenant.reduce((s, r) => s + r.count, 0);
    const start = (params.page - 1) * params.limit;
    const data = all.slice(start, start + params.limit);
    return { data, total, page: params.page, limit: params.limit };
  }

  /**
   * One bill's full detail (items, transactions, summary), re-entering the business
   * it belongs to (`tenantId` from the list row). Owner-checked: the order must
   * belong to one of the person's patient records in that business.
   * @throws NotFoundException when the bill isn't the patient's (no info leak)
   */
  async getBillDetail(
    personId: string,
    tenantId: string,
    orderId: string,
  ): Promise<PatientBillDetail> {
    const detail = await this.prisma.runWithTenant(tenantId, async () => {
      const patientIds = await this.resolvePatientIds(tenantId, personId);
      const order = await this.prisma.order.findFirst({
        where: {
          id: orderId,
          tenantId,
          patientId: { in: patientIds },
          deletedAt: null,
          status: { in: BILL_STATUSES },
        },
        select: {
          id: true,
          orderCode: true,
          billId: true,
          createdAt: true,
          billStatus: true,
          grossAmount: true,
          discountAmount: true,
          netAmount: true,
          paidAmount: true,
          cancellationCharge: true,
          branch: { select: { name: true } },
          patient: {
            select: {
              salutation: true,
              firstName: true,
              middleName: true,
              lastName: true,
            },
          },
          items: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            select: {
              unitPrice: true,
              discount: true,
              branchLabTest: {
                select: { testDisplayName: true, testName: true },
              },
              branchLabPanel: { select: { panelName: true } },
              direct: true,
            },
          },
          payments: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              paidAmount: true,
              refundAmount: true,
              refundCharge: true,
              paymentMode: true,
              notes: true,
              paymentDate: true,
              createdAt: true,
              entryType: true,
              revertedAt: true,
            },
          },
        },
      });
      if (!order) {
        throw new NotFoundException('Bill', orderId);
      }

      const items: PatientBillItem[] = order.items.map((it) => {
        const unitPrice = it.unitPrice;
        const discount = Number(it.discount);
        const name =
          firstNonBlank(
            it.branchLabTest?.testDisplayName,
            it.branchLabTest?.testName,
            it.branchLabPanel?.panelName,
            it.direct,
          ) ?? '—';
        const type = it.branchLabTest
          ? 'Test'
          : it.branchLabPanel
            ? 'Lab Panel'
            : 'Other';
        return {
          type,
          name,
          quantity: 1,
          unitPrice,
          totalPrice: round2(unitPrice - discount),
        };
      });

      // Transactions = real collections + refunds (skip reverted + net-only rows),
      // mirroring the staff "Payment History".
      const live = order.payments.filter(
        (p) =>
          !p.revertedAt &&
          (Number(p.paidAmount) > 0 || p.entryType === PaymentEntryType.REFUND),
      );
      const transactions: PatientBillTransaction[] = live.map((p) => {
        const isRefund = p.entryType === PaymentEntryType.REFUND;
        return {
          id: p.id,
          paidOn: (p.paymentDate ?? p.createdAt).toISOString(),
          method: paymentModeLabel(p.paymentMode),
          notes: p.notes ?? '',
          amountPaid: isRefund ? 0 : Number(p.paidAmount),
          refundedAmount: isRefund ? Number(p.refundAmount) : 0,
        };
      });

      // Summary from the authoritative rollups (gross/discount/net/paid). Balance
      // follows the same math as the staff page: net − effective paid, where
      // effective paid = paid − cancellation charge − refunds − refund charges.
      const refunded = live.reduce((s, p) => s + Number(p.refundAmount), 0);
      const refundCharges = live.reduce(
        (s, p) => s + Number(p.refundCharge),
        0,
      );
      const effectivePaid = Math.max(
        0,
        round2(
          order.paidAmount -
            Number(order.cancellationCharge) -
            refunded -
            refundCharges,
        ),
      );

      return {
        orderId: order.id,
        orderCode: order.orderCode,
        billNumber: order.billId ?? order.orderCode,
        patientName: composeName(order.patient),
        orderDate: order.createdAt.toISOString(),
        branchName: order.branch?.name ?? null,
        tenantName: null as string | null,
        billStatus: order.billStatus,
        billStatusLabel: BILL_STATUS_LABELS[order.billStatus],
        items,
        transactions,
        summary: {
          orderAmount: order.grossAmount,
          discount: order.discountAmount,
          netAmount: order.netAmount,
          totalPaid: order.paidAmount,
          balance: round2(order.netAmount - effectivePaid),
        },
      } satisfies PatientBillDetail;
    });

    // Stamp the business name (platform-level read, RLS-exempt).
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { name: true },
    });
    detail.tenantName = tenant?.name ?? null;
    return detail;
  }

  /**
   * Render the patient's bill as a PDF using the `bill_print` template (the
   * Configuration default for the order's branch → first active), reusing the same
   * order-print engine as staff — re-entering the business the bill belongs to
   * (`tenantId` from the list row). Owner-checked before rendering.
   */
  async getBillPdf(
    personId: string,
    tenantId: string,
    orderId: string,
  ): Promise<Buffer> {
    return this.prisma.runWithTenant(tenantId, async () => {
      const patientIds = await this.resolvePatientIds(tenantId, personId);
      const order = await this.prisma.order.findFirst({
        where: {
          id: orderId,
          tenantId,
          patientId: { in: patientIds },
          deletedAt: null,
          status: { in: BILL_STATUSES },
        },
        select: { id: true, branchId: true },
      });
      if (!order) {
        throw new NotFoundException('Bill', orderId);
      }
      const templateId =
        await this.pdfTemplateConfigService.resolveTemplateIdForType(
          tenantId,
          order.branchId,
          BILL_TEMPLATE_TYPE,
        );
      return this.orderService.print(
        orderId,
        tenantId,
        BILL_TEMPLATE_TYPE,
        templateId,
      );
    });
  }
}
