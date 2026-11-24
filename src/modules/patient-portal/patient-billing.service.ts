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
import { ListPatientBranchesDto } from './dto/list-patient-bills.dto';
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
  PatientBranchOption,
} from './entities/patient-bill.entity';

/** The bill print-template slot — "Lab Order Bill". */
const BILL_TEMPLATE_TYPE = 'bill_print';

/**
 * Patient-facing billing: lists + details the authenticated patient's bills
 * across EVERY branch of the active tenant (no branch scoping of ownership), and
 * renders the bill PDF via the same `bill_print` template + order rollups the
 * staff `/registration/billing` page uses — so the numbers never diverge. Every
 * read is scoped to the person's patient record(s) + tenant from the JWT; a
 * patient can never reach another patient's bill by changing an id.
 */
@Injectable()
export class PatientBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    private readonly pdfTemplateConfigService: PdfTemplateConfigService,
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

  /**
   * Paginated bill list for the patient, consolidated across all branches of the
   * tenant. Server-side filters: date range, branch, bill status. Appointment
   * orders with nothing collected are hidden (they're not yet real bills).
   */
  async listBills(
    tenantId: string,
    personId: string,
    params: {
      dateFrom?: string;
      dateTo?: string;
      branchId?: string;
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
    const patientIds = await this.resolvePatientIds(tenantId, personId);
    if (patientIds.length === 0) {
      return { data: [], total: 0, page: params.page, limit: params.limit };
    }

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
    if (params.branchId) where.branchId = params.branchId;
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

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
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

    const data: PatientBillRow[] = rows.map((o) => ({
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
    }));
    return { data, total, page: params.page, limit: params.limit };
  }

  /**
   * One bill's full detail (items, transactions, summary), owner-checked: the
   * order must belong to one of the person's patient records in the tenant.
   * @throws NotFoundException when the bill isn't the patient's (no info leak)
   */
  async getBillDetail(
    tenantId: string,
    personId: string,
    orderId: string,
  ): Promise<PatientBillDetail> {
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
    const refundCharges = live.reduce((s, p) => s + Number(p.refundCharge), 0);
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
    };
  }

  /**
   * Render the patient's bill as a PDF using the `bill_print` template (the
   * Configuration default for the order's branch → first active), reusing the
   * same order-print engine as staff. Owner-checked before rendering.
   */
  async getBillPdf(
    tenantId: string,
    personId: string,
    orderId: string,
  ): Promise<Buffer> {
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
  }

  /** Paginated, searchable branch list for the filter dropdown (tenant-scoped). */
  async listBranches(
    tenantId: string,
    params: ListPatientBranchesDto,
  ): Promise<{
    data: PatientBranchOption[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where: Prisma.BranchWhereInput = { tenantId, deletedAt: null };
    const search = params.search?.trim();
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.prisma.branch.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, name: true },
      }),
      this.prisma.branch.count({ where }),
    ]);
    return { data: rows, total, page, limit };
  }
}
