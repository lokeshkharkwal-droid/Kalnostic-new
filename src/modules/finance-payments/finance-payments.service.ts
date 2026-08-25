import { Injectable } from '@nestjs/common';
import {
  InvoicePartyType,
  InvoicePaymentStatus,
  OrderStatus,
  PaymentEntryType,
  PaymentMode,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { toNum } from '../../common/utils/decimal-to-number.util';
import { roundToTwoDecimalPlaces } from '../../common/utils/round-to-two-decimal-places.util';
import {
  FinancePaymentsSummary,
  PaymentLedgerItem,
  PaymentLedgerStatus,
  paymentModeLabel,
} from './entities/finance-payment.entity';
import {
  FinancePaymentsSummaryQueryDto,
  PaymentLedgerStatusFilter,
} from './dto/finance-payments-summary-query.dto';
import { ListFinancePaymentsDto } from './dto/list-finance-payments.dto';
import { FinancePaymentBranchNotFoundException } from './exceptions/finance-payments.exceptions';

/** `include` for a Direct (order) payment row → everything the ledger renders. */
const DIRECT_INCLUDE = {
  order: {
    select: {
      id: true,
      orderCode: true,
      billId: true,
      status: true,
      createdBy: true,
      patient: {
        select: {
          firstName: true,
          middleName: true,
          lastName: true,
          mobile: true,
        },
      },
      referralPanel: { select: { name: true } },
      referredByDoctor: { select: { firstName: true, lastName: true } },
      internalReferral: { select: { fullName: true } },
      externalReferral: { select: { name: true } },
    },
  },
} satisfies Prisma.PaymentDetailsInclude;

type DirectRow = Prisma.PaymentDetailsGetPayload<{
  include: typeof DIRECT_INCLUDE;
}>;

/** `include` for an Invoice payment row → everything the ledger renders. */
const INVOICE_INCLUDE = {
  invoice: {
    select: {
      id: true,
      invoiceNo: true,
      paymentStatus: true,
      partyType: true,
      partyName: true,
      partyMobile: true,
    },
  },
} satisfies Prisma.InvoicePaymentInclude;

type InvoiceRow = Prisma.InvoicePaymentGetPayload<{
  include: typeof INVOICE_INCLUDE;
}>;

/** Mutable accumulator for the summary mode buckets. */
interface ModeBuckets {
  cash: number;
  upi: number;
  bankTransfer: number;
  debitCard: number;
  creditCard: number;
}

/**
 * Finance → Payments consolidated ledger. Merges the two payment sources — order
 * payments (`PaymentDetails`, Direct) and invoice receipts (`InvoicePayment`,
 * Invoice) — into one filterable, paginated view, plus a summary aggregate for
 * the KPI cards. Read-only + tenant-scoped (Prisma-direct; the RLS extension sets
 * the tenant GUC per op). Money is whole rupees in both sources, so amounts merge
 * without conversion.
 *
 * Status is **derived** (no per-payment status column): a REFUND ledger row →
 * `REFUNDED`; a payment whose parent order/invoice is CANCELLED → `CANCELLED`;
 * otherwise `COMPLETED`. Writes (record / cancel) reuse the existing order,
 * payment-details and invoice endpoints — this module never mutates.
 */
@Injectable()
export class FinancePaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List ledger rows (offset pagination) merged from both sources, newest first.
   * Honours every filter incl. `mode` and `status`. Pagination merges the top
   * `page*limit` of each source and slices — correct totals via per-source counts.
   * @param tenantId tenant scope (from JWT)
   * @param query filters + pagination
   * @returns a page of unified ledger items
   * @throws FinancePaymentBranchNotFoundException if a `branchId` filter is not in the tenant
   */
  async findAll(
    tenantId: string,
    query: ListFinancePaymentsDto,
  ): Promise<PaginatedResult<PaymentLedgerItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    await this.assertBranch(tenantId, query.branchId);

    const useDirect = query.type !== 'INVOICE';
    // Invoices have no refund concept in the ledger → skip them when filtering to REFUNDED.
    const invoiceBase =
      query.type !== 'DIRECT' && query.status !== 'REFUNDED'
        ? this.invoiceBaseWhere(tenantId, query)
        : null;

    const take = page * limit;
    const directWhere = useDirect
      ? this.directRecordsWhere(tenantId, query)
      : null;
    // invoiceBase === null also covers an impossible referral combo (see builder).
    const invoiceWhere = invoiceBase
      ? this.composeInvoiceRecordsWhere(invoiceBase, query)
      : null;

    const [directRows, directCount, invoiceRows, invoiceCount] =
      await Promise.all([
        directWhere
          ? this.prisma.paymentDetails.findMany({
              where: directWhere,
              include: DIRECT_INCLUDE,
              orderBy: { createdAt: 'desc' },
              take,
            })
          : Promise.resolve([] as DirectRow[]),
        directWhere
          ? this.prisma.paymentDetails.count({ where: directWhere })
          : Promise.resolve(0),
        invoiceWhere
          ? this.prisma.invoicePayment.findMany({
              where: invoiceWhere,
              include: INVOICE_INCLUDE,
              orderBy: { createdAt: 'desc' },
              take,
            })
          : Promise.resolve([] as InvoiceRow[]),
        invoiceWhere
          ? this.prisma.invoicePayment.count({ where: invoiceWhere })
          : Promise.resolve(0),
      ]);

    const merged = [
      ...directRows.map((r) => this.mapDirect(r)),
      ...invoiceRows.map((r) => this.mapInvoice(r)),
    ].sort((a, b) =>
      a.dateTime < b.dateTime ? 1 : a.dateTime > b.dateTime ? -1 : 0,
    );
    const pageItems = merged.slice((page - 1) * limit, take);
    await this.resolveNamesInPlace(tenantId, pageItems);

    return {
      data: pageItems,
      total: directCount + invoiceCount,
      page,
      limit,
    };
  }

  /**
   * KPI totals for the summary cards over the active filters. Ignores `mode` and
   * `status` (it computes the full breakdown), but honours branch/date/type/
   * referral/user/search. Uses `groupBy`/`aggregate` per source.
   * @param tenantId tenant scope (from JWT)
   * @param query the shared filters
   * @returns mode totals + cancelled/refunded counts and amounts
   * @throws FinancePaymentBranchNotFoundException if a `branchId` filter is not in the tenant
   */
  async getSummary(
    tenantId: string,
    query: FinancePaymentsSummaryQueryDto,
  ): Promise<FinancePaymentsSummary> {
    await this.assertBranch(tenantId, query.branchId);

    const useDirect = query.type !== 'INVOICE';
    const useInvoice = query.type !== 'DIRECT';
    const dBase = this.directBaseWhere(tenantId, query);
    const iBase = useInvoice ? this.invoiceBaseWhere(tenantId, query) : null;

    const buckets: ModeBuckets = {
      cash: 0,
      upi: 0,
      bankTransfer: 0,
      debitCard: 0,
      creditCard: 0,
    };
    let cancelledAmount = 0;
    let cancelledCount = 0;
    let refundedAmount = 0;
    let refundedCount = 0;

    if (useDirect) {
      const completed = await this.prisma.paymentDetails.groupBy({
        by: ['paymentMode'],
        where: {
          AND: [
            dBase,
            {
              entryType: PaymentEntryType.PAYMENT,
              order: { status: { not: OrderStatus.CANCELLED } },
            },
          ],
        },
        _sum: { paidAmount: true },
      });
      for (const g of completed) {
        this.addToBucket(buckets, g.paymentMode, toNum(g._sum.paidAmount));
      }

      const refund = await this.prisma.paymentDetails.aggregate({
        where: { AND: [dBase, { entryType: PaymentEntryType.REFUND }] },
        _sum: { refundAmount: true },
        _count: { _all: true },
      });
      refundedAmount += toNum(refund._sum.refundAmount);
      refundedCount += refund._count._all;

      const cancelled = await this.prisma.paymentDetails.aggregate({
        where: {
          AND: [
            dBase,
            {
              entryType: PaymentEntryType.PAYMENT,
              order: { status: OrderStatus.CANCELLED },
            },
          ],
        },
        _sum: { paidAmount: true },
        _count: { _all: true },
      });
      cancelledAmount += toNum(cancelled._sum.paidAmount);
      cancelledCount += cancelled._count._all;
    }

    if (useInvoice && iBase) {
      const completed = await this.prisma.invoicePayment.groupBy({
        by: ['paymentMode'],
        where: {
          AND: [
            iBase,
            {
              invoice: {
                paymentStatus: { not: InvoicePaymentStatus.CANCELLED },
              },
            },
          ],
        },
        _sum: { amount: true },
      });
      for (const g of completed) {
        this.addToBucket(buckets, g.paymentMode, g._sum.amount ?? 0);
      }

      const cancelled = await this.prisma.invoicePayment.aggregate({
        where: {
          AND: [
            iBase,
            { invoice: { paymentStatus: InvoicePaymentStatus.CANCELLED } },
          ],
        },
        _sum: { amount: true },
        _count: { _all: true },
      });
      cancelledAmount += cancelled._sum.amount ?? 0;
      cancelledCount += cancelled._count._all;
    }

    const totalPayments = roundToTwoDecimalPlaces(
      buckets.cash +
        buckets.upi +
        buckets.bankTransfer +
        buckets.debitCard +
        buckets.creditCard,
    );

    return {
      totalPayments,
      cash: roundToTwoDecimalPlaces(buckets.cash),
      upi: roundToTwoDecimalPlaces(buckets.upi),
      bankTransfer: roundToTwoDecimalPlaces(buckets.bankTransfer),
      debitCard: roundToTwoDecimalPlaces(buckets.debitCard),
      creditCard: roundToTwoDecimalPlaces(buckets.creditCard),
      cancelledCount,
      cancelledAmount: roundToTwoDecimalPlaces(cancelledAmount),
      refundedCount,
      refundedAmount: roundToTwoDecimalPlaces(refundedAmount),
    };
  }

  // ── where builders ──────────────────────────────────────────────────────────

  /**
   * Shared Direct-source filters (branch, date, referral, user, search) — no
   * `mode`/`status` (those are layered on per caller).
   */
  private directBaseWhere(
    tenantId: string,
    q: FinancePaymentsSummaryQueryDto,
  ): Prisma.PaymentDetailsWhereInput {
    const where: Prisma.PaymentDetailsWhereInput = {
      tenantId,
      deletedAt: null,
    };
    const and: Prisma.PaymentDetailsWhereInput[] = [];

    if (q.branchId) where.branchId = q.branchId;

    const range = this.dateRange(q.dateFrom, q.dateTo);
    if (range) {
      // Transaction date = paymentDate ?? createdAt.
      and.push({
        OR: [{ paymentDate: range }, { paymentDate: null, createdAt: range }],
      });
    }

    const orderWhere: Prisma.OrderWhereInput = {};
    if (q.referralPanelId) orderWhere.referralPanelId = q.referralPanelId;
    if (q.referredByDoctorId)
      orderWhere.referredByDoctorId = q.referredByDoctorId;
    if (q.internalReferralId)
      orderWhere.internalReferralId = q.internalReferralId;
    if (q.externalReferralId)
      orderWhere.externalReferralId = q.externalReferralId;
    if (q.userId) orderWhere.createdBy = q.userId;
    if (Object.keys(orderWhere).length) where.order = orderWhere;

    const s = q.search?.trim();
    if (s) {
      and.push({
        OR: [
          { id: { contains: s, mode: 'insensitive' } },
          { reference: { contains: s, mode: 'insensitive' } },
          { order: { billId: { contains: s, mode: 'insensitive' } } },
          { order: { orderCode: { contains: s, mode: 'insensitive' } } },
          {
            order: {
              patient: { firstName: { contains: s, mode: 'insensitive' } },
            },
          },
          {
            order: {
              patient: { lastName: { contains: s, mode: 'insensitive' } },
            },
          },
          { order: { patient: { mobile: { contains: s } } } },
        ],
      });
    }

    if (and.length) where.AND = and;
    return where;
  }

  /**
   * Shared Invoice-source filters. Returns `null` when the referral filters can
   * never match an invoice (an invoice bills exactly one party dimension, so >1
   * distinct referral filter is unsatisfiable).
   */
  private invoiceBaseWhere(
    tenantId: string,
    q: FinancePaymentsSummaryQueryDto,
  ): Prisma.InvoicePaymentWhereInput | null {
    const where: Prisma.InvoicePaymentWhereInput = {
      tenantId,
      deletedAt: null,
    };
    const and: Prisma.InvoicePaymentWhereInput[] = [];

    if (q.branchId) where.branchId = q.branchId;

    const range = this.dateRange(q.dateFrom, q.dateTo);
    if (range) where.paymentDate = range;

    if (q.userId) where.createdBy = q.userId;

    const partyFilters: Array<{ type: InvoicePartyType; id: string }> = [];
    if (q.referralPanelId) {
      partyFilters.push({ type: InvoicePartyType.B2B, id: q.referralPanelId });
    }
    if (q.referredByDoctorId) {
      partyFilters.push({
        type: InvoicePartyType.REFERRED_BY,
        id: q.referredByDoctorId,
      });
    }
    if (q.internalReferralId) {
      partyFilters.push({
        type: InvoicePartyType.INTERNAL_REFERRAL_USER,
        id: q.internalReferralId,
      });
    }
    if (q.externalReferralId) {
      partyFilters.push({
        type: InvoicePartyType.EXTERNAL_REFERRAL_USER,
        id: q.externalReferralId,
      });
    }
    if (partyFilters.length > 1) return null;
    const pf = partyFilters[0];
    if (pf) where.invoice = { partyType: pf.type, partyId: pf.id };

    const s = q.search?.trim();
    if (s) {
      and.push({
        OR: [
          { id: { contains: s, mode: 'insensitive' } },
          { reference: { contains: s, mode: 'insensitive' } },
          { invoice: { invoiceNo: { contains: s, mode: 'insensitive' } } },
          { invoice: { partyName: { contains: s, mode: 'insensitive' } } },
          { invoice: { partyMobile: { contains: s } } },
        ],
      });
    }

    if (and.length) where.AND = and;
    return where;
  }

  /** Compose the Direct records `where`: base + optional mode + optional status. */
  private directRecordsWhere(
    tenantId: string,
    q: ListFinancePaymentsDto,
  ): Prisma.PaymentDetailsWhereInput {
    const clauses: Prisma.PaymentDetailsWhereInput[] = [
      this.directBaseWhere(tenantId, q),
    ];
    if (q.mode) clauses.push({ paymentMode: q.mode });
    const status = this.directStatusClause(q.status);
    if (status) clauses.push(status);
    return { AND: clauses };
  }

  /** Compose the Invoice records `where`: base + optional mode + optional status. */
  private composeInvoiceRecordsWhere(
    base: Prisma.InvoicePaymentWhereInput,
    q: ListFinancePaymentsDto,
  ): Prisma.InvoicePaymentWhereInput {
    const clauses: Prisma.InvoicePaymentWhereInput[] = [base];
    if (q.mode) clauses.push({ paymentMode: q.mode });
    const status = this.invoiceStatusClause(q.status);
    if (status) clauses.push(status);
    return { AND: clauses };
  }

  /** Direct-source clause for a status filter (null = no restriction). */
  private directStatusClause(
    status: PaymentLedgerStatusFilter | undefined,
  ): Prisma.PaymentDetailsWhereInput | null {
    switch (status) {
      case 'COMPLETED':
        return {
          entryType: PaymentEntryType.PAYMENT,
          order: { status: { not: OrderStatus.CANCELLED } },
        };
      case 'CANCELLED':
        return {
          entryType: PaymentEntryType.PAYMENT,
          order: { status: OrderStatus.CANCELLED },
        };
      case 'REFUNDED':
        return { entryType: PaymentEntryType.REFUND };
      default:
        return null;
    }
  }

  /** Invoice-source clause for a status filter (null = no restriction). */
  private invoiceStatusClause(
    status: PaymentLedgerStatusFilter | undefined,
  ): Prisma.InvoicePaymentWhereInput | null {
    switch (status) {
      case 'COMPLETED':
        return {
          invoice: { paymentStatus: { not: InvoicePaymentStatus.CANCELLED } },
        };
      case 'CANCELLED':
        return { invoice: { paymentStatus: InvoicePaymentStatus.CANCELLED } };
      default:
        // REFUNDED never matches an invoice; handled by skipping the source.
        return null;
    }
  }

  // ── mappers ─────────────────────────────────────────────────────────────────

  /** Map a Direct (`PaymentDetails`) row to a unified ledger item (names resolved later). */
  private mapDirect(r: DirectRow): PaymentLedgerItem {
    const o = r.order;
    const isRefund = r.entryType === PaymentEntryType.REFUND;
    const status: PaymentLedgerStatus = isRefund
      ? 'REFUNDED'
      : o.status === OrderStatus.CANCELLED
        ? 'CANCELLED'
        : 'COMPLETED';
    const p = o.patient;
    const customerName = [p.firstName, p.middleName, p.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const doctor = o.referredByDoctor;
    return {
      paymentId: r.id,
      dateTime: (r.paymentDate ?? r.createdAt).toISOString(),
      type: 'DIRECT',
      billOrInvoiceId: o.billId ?? o.orderCode,
      customerName,
      mobile: p.mobile,
      amount: toNum(isRefund ? r.refundAmount : r.paidAmount),
      mode: paymentModeLabel(r.paymentMode),
      modeKey: r.paymentMode,
      refId: r.reference,
      user: null,
      userId: o.createdBy,
      branch: null,
      branchId: r.branchId,
      status,
      referralPanel: o.referralPanel?.name ?? null,
      referredBy: doctor
        ? [doctor.firstName, doctor.lastName].filter(Boolean).join(' ').trim()
        : null,
      internalReferralUser: o.internalReferral?.fullName ?? null,
      externalReferralUser: o.externalReferral?.name ?? null,
      notes: r.notes,
      attachmentUrl: null,
      orderId: r.orderId,
      invoiceId: null,
    };
  }

  /** Map an Invoice (`InvoicePayment`) row to a unified ledger item (names resolved later). */
  private mapInvoice(r: InvoiceRow): PaymentLedgerItem {
    const inv = r.invoice;
    const status: PaymentLedgerStatus =
      inv.paymentStatus === InvoicePaymentStatus.CANCELLED
        ? 'CANCELLED'
        : 'COMPLETED';
    const party = inv.partyName;
    return {
      paymentId: r.id,
      dateTime: r.paymentDate.toISOString(),
      type: 'INVOICE',
      billOrInvoiceId: inv.invoiceNo,
      customerName: party,
      mobile: inv.partyMobile,
      amount: r.amount,
      mode: paymentModeLabel(r.paymentMode),
      modeKey: r.paymentMode,
      refId: r.reference,
      user: null,
      userId: r.createdBy,
      branch: null,
      branchId: r.branchId,
      status,
      referralPanel: inv.partyType === InvoicePartyType.B2B ? party : null,
      referredBy: inv.partyType === InvoicePartyType.REFERRED_BY ? party : null,
      internalReferralUser:
        inv.partyType === InvoicePartyType.INTERNAL_REFERRAL_USER
          ? party
          : null,
      externalReferralUser:
        inv.partyType === InvoicePartyType.EXTERNAL_REFERRAL_USER
          ? party
          : null,
      notes: r.notes,
      attachmentUrl: r.attachmentUrl,
      orderId: null,
      invoiceId: r.invoiceId,
    };
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  /** Add a mode's amount to the right summary bucket (WALLET excluded, per §). */
  private addToBucket(
    buckets: ModeBuckets,
    mode: PaymentMode,
    amount: number,
  ): void {
    switch (mode) {
      case PaymentMode.CASH:
        buckets.cash += amount;
        break;
      case PaymentMode.UPI:
        buckets.upi += amount;
        break;
      case PaymentMode.BANK_TRANSFER:
        buckets.bankTransfer += amount;
        break;
      case PaymentMode.CARD:
        buckets.debitCard += amount;
        break;
      case PaymentMode.CREDIT:
        buckets.creditCard += amount;
        break;
      case PaymentMode.WALLET:
        break;
    }
  }

  /**
   * Batch-resolve actor (`Person`) names and branch names for a page of items,
   * mutating each item's `user` / `branch` in place. One lookup per dimension.
   */
  private async resolveNamesInPlace(
    tenantId: string,
    items: PaymentLedgerItem[],
  ): Promise<void> {
    const personIds = [
      ...new Set(
        items.map((i) => i.userId).filter((x): x is string => Boolean(x)),
      ),
    ];
    const branchIds = [
      ...new Set(
        items.map((i) => i.branchId).filter((x): x is string => Boolean(x)),
      ),
    ];

    const [persons, branches] = await Promise.all([
      personIds.length
        ? this.prisma.person.findMany({
            where: { id: { in: personIds } },
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
            },
          })
        : Promise.resolve([]),
      branchIds.length
        ? this.prisma.branch.findMany({
            where: { id: { in: branchIds }, tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const nameById = new Map<string, string>();
    for (const p of persons) {
      const name = [p.firstName, p.middleName, p.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      nameById.set(p.id, name || p.id);
    }
    const branchById = new Map<string, string>();
    for (const b of branches) branchById.set(b.id, b.name);

    for (const it of items) {
      it.user = it.userId ? (nameById.get(it.userId) ?? null) : null;
      it.branch = it.branchId ? (branchById.get(it.branchId) ?? null) : null;
    }
  }

  /**
   * Validate an optional `branchId` filter belongs to the caller's tenant.
   * @throws FinancePaymentBranchNotFoundException when it doesn't
   */
  private async assertBranch(
    tenantId: string,
    branchId: string | undefined,
  ): Promise<void> {
    if (!branchId) return;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) {
      throw new FinancePaymentBranchNotFoundException(branchId);
    }
  }

  /** Build an inclusive `{ gte, lte }` date range; end-of-day when a date-only string. */
  private dateRange(
    from: string | undefined,
    to: string | undefined,
  ): { gte?: Date; lte?: Date } | undefined {
    if (!from && !to) return undefined;
    const range: { gte?: Date; lte?: Date } = {};
    if (from) range.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        end.setHours(23, 59, 59, 999);
      }
      range.lte = end;
    }
    return range;
  }
}
