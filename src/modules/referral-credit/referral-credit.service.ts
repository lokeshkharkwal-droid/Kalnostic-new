import { Injectable } from '@nestjs/common';
import {
  InvoicePaymentStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ReferralClientType,
  type ReferralPanelSettings,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toNum, roundToTwoDecimalPlaces } from '../../common/utils';
import {
  computeEffectivePaid,
  derivePaymentStatus,
} from '../order/entities/order.entity';
import {
  ReferralOrderCreditLimitException,
  ReferralOrderCreditDaysException,
  ReferralReportCreditLimitException,
  ReferralReportCreditDaysException,
} from './referral-credit.exceptions';

/** The four ways an order can name a referral (B2B) account. */
export interface OrderReferralRefs {
  referredByDoctorId?: string | null;
  referralPanelId?: string | null;
  internalReferralId?: string | null;
  externalReferralId?: string | null;
}

type ReferralKind = 'PANEL' | 'DOCTOR' | 'INTERNAL' | 'EXTERNAL';
interface ReferralRef {
  kind: ReferralKind;
  id: string;
}

/**
 * Whether a bill / report may be dispatched to each recipient type for an order,
 * per its linked referral's `ReferralPanelSettings` communication toggles
 * (Section 4 — Communication). All `true` when the order has no referral/setting
 * so walk-in / non-B2B orders keep today's behaviour.
 */
export interface OrderCommunicationPolicy {
  billToPatient: boolean;
  billToB2b: boolean;
  billToDoctor: boolean;
  reportToPatient: boolean;
  reportToB2b: boolean;
  reportToDoctor: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the report gate loads for the order whose report is being opened: its
 * referral ids, plus the payment state that decides whether it is fully paid
 * (active ledger rows, the retained cancellation fee, and an active link to a
 * fully-paid invoice, if any).
 */
const REPORT_ORDER_SELECT = {
  referredByDoctorId: true,
  referralPanelId: true,
  internalReferralId: true,
  externalReferralId: true,
  cancellationCharge: true,
  payments: {
    where: { deletedAt: null },
    select: {
      netAmount: true,
      paidAmount: true,
      refundAmount: true,
      refundCharge: true,
    },
  },
  invoiceLinks: {
    where: {
      deletedAt: null,
      invoice: {
        deletedAt: null,
        paymentStatus: InvoicePaymentStatus.COMPLETED,
      },
    },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.OrderSelect;

/** The payment state {@link ReferralCreditService} needs to call an order fully paid. */
interface OrderPaymentState {
  cancellationCharge: Prisma.Decimal | null;
  payments: Array<{
    netAmount: Prisma.Decimal | null;
    paidAmount: Prisma.Decimal | null;
    refundAmount: Prisma.Decimal | null;
    refundCharge: Prisma.Decimal | null;
  }>;
  invoiceLinks: Array<{ id: string }>;
}

/**
 * Enforces the credit rules defined by a Referral Panel Setting (Section 4 —
 * Referral Panel Settings) at two points in the request path:
 *
 *  - **Order creation** — Restrict Create Order (Credit Limit / Credit Days).
 *  - **Report access** — Restrict Report Access (Credit Limit / Credit Days).
 *
 * A referral (`ReferralPanel` / `ReferralDoctor` / `InternalReferral` /
 * `ExternalReferral`) links to a `ReferralPanelSettings` row. A referral's
 * outstanding balance is computed on the fly — the sum of `net − paid`
 * (floored per order) over the referral's active orders — mirroring
 * `OrderService.getPatientOutstanding`; no denormalised balance table is
 * needed. An invoiced order's money lives on the invoice ledger, not in its
 * `PaymentDetails`, so an order whose invoice is fully paid (`COMPLETED`) is
 * treated as settled and left out — the same rule the Outstanding report uses
 * (`OrderService.invoiceSettledOrderIds`). Only `CASH` and `POSTPAID` settings
 * carry credit rules (Prepaid uses the wallet model, which is out of scope here).
 *
 * Report access is never blocked for a **fully paid** order: when the order
 * whose report is being opened is PAID (same rule as its stored
 * `paymentStatus`) or sits on a COMPLETED invoice, its reports open whatever
 * the referral's settings or other dues are. The credit rules only gate the
 * reports of partly-paid / unpaid orders.
 *
 * The gates are deliberately conservative: they only bite when the setting's
 * `isRestrict…` flag is ON **and** the corresponding limit/day value is `> 0`.
 * The Cash default (Credit Limit 0 = "pay in full at the counter", handled by
 * the billing flow) therefore enforces nothing here, so turning the feature on
 * is an explicit admin choice and existing flows are never silently blocked.
 * Injected via DI into `OrderService` / `LabReportService` (CLAUDE.md rule #3).
 */
/** Every recipient allowed — the default when an order has no referral/setting. */
const ALLOW_ALL_COMMUNICATION: OrderCommunicationPolicy = {
  billToPatient: true,
  billToB2b: true,
  billToDoctor: true,
  reportToPatient: true,
  reportToB2b: true,
  reportToDoctor: true,
};

@Injectable()
export class ReferralCreditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the bill/report communication policy for an order from its linked
   * referral's `ReferralPanelSettings` (Section 4 — Communication). Picks the
   * first referral that carries a setting (panel → doctor → internal → external).
   * When the order has no referral, or none carries a setting, every recipient is
   * allowed so walk-in / non-B2B orders are unaffected. Callers gate each
   * dispatch (patient / B2B / doctor) against the returned flags.
   * @param tenantId tenant scope (RLS also isolates to this tenant)
   * @param orderId the order being billed / reported
   */
  async resolveOrderCommunicationPolicy(
    tenantId: string,
    orderId: string,
  ): Promise<OrderCommunicationPolicy> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: {
        referralPanel: { select: { referralPanelSettings: true } },
        referredByDoctor: { select: { referralPanelSettings: true } },
        internalReferral: { select: { referralPanelSettings: true } },
        externalReferral: { select: { referralPanelSettings: true } },
      },
    });
    const setting =
      order?.referralPanel?.referralPanelSettings ??
      order?.referredByDoctor?.referralPanelSettings ??
      order?.internalReferral?.referralPanelSettings ??
      order?.externalReferral?.referralPanelSettings ??
      null;
    if (!setting) return ALLOW_ALL_COMMUNICATION;
    return {
      billToPatient: setting.isSendBillsToPatient,
      billToB2b: setting.isSendBillsToB2b,
      billToDoctor: setting.isSendBillsToDoctor,
      reportToPatient: setting.isSendReportsToPatient,
      reportToB2b: setting.isSendReportsToB2b,
      reportToDoctor: setting.isSendReportsToDoctor,
    };
  }

  /**
   * Block a new order when any linked Cash/Postpaid referral has reached its
   * Credit Limit or exceeded its Credit Allowed Days (and the matching
   * `isRestrictOrder…` flag is on). No-op when the order names no referral.
   * @param tenantId tenant scope (RLS also isolates to this tenant)
   * @param input the order's referral ids
   * @param excludeOrderId an order to exclude from the balance (e.g. the one being finalized)
   * @throws ReferralOrderCreditLimitException when outstanding ≥ credit limit
   * @throws ReferralOrderCreditDaysException when the oldest unpaid order is older than credit days
   */
  async assertOrderCreationAllowed(
    tenantId: string,
    input: OrderReferralRefs,
    excludeOrderId?: string,
  ): Promise<void> {
    const refs = this.refs(input);
    if (refs.length === 0) return;
    const now = new Date();
    for (const ref of refs) {
      const setting = await this.settingFor(tenantId, ref);
      if (!this.hasCreditRules(setting)) continue;
      const limit = toNum(setting.creditLimitAmount);
      const days = setting.creditAllowedDays ?? 0;
      const limitOn = setting.isRestrictOrderCreditLimit && limit > 0;
      const daysOn = setting.isRestrictOrderCreditDays && days > 0;
      if (!limitOn && !daysOn) continue;

      const orders = await this.loadReferralOrders(
        tenantId,
        ref,
        excludeOrderId,
      );
      if (limitOn) {
        const outstanding = this.outstandingOf(orders);
        if (outstanding >= limit) {
          throw new ReferralOrderCreditLimitException(
            setting.settingName,
            outstanding,
            limit,
          );
        }
      }
      if (daysOn) {
        const ageDays = this.oldestUnpaidAgeDays(orders, now);
        if (ageDays > days) {
          throw new ReferralOrderCreditDaysException(
            setting.settingName,
            ageDays,
            days,
          );
        }
      }
    }
  }

  /**
   * Block report access (print/download/share) for an order whose linked
   * Cash/Postpaid referral has reached its Credit Limit or exceeded Credit
   * Allowed Days (and the matching `isRestrictReport…` flag is on). A fully
   * paid order is always allowed (see {@link isOrderFullyPaid}). Resolves the
   * order by id.
   */
  async assertReportAccessAllowedByOrderId(
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: REPORT_ORDER_SELECT,
    });
    // Missing order: let the caller's own not-found handling report it.
    if (!order) return;
    if (this.isOrderFullyPaid(order)) return;
    await this.assertReportAccessAllowed(tenantId, order);
  }

  /**
   * Same as {@link assertReportAccessAllowedByOrderId} but resolves the order
   * from a single lab report (report → orderItem → order).
   */
  async assertReportAccessAllowedByReportId(
    tenantId: string,
    reportId: string,
  ): Promise<void> {
    const report = await this.prisma.labReport.findFirst({
      where: { id: reportId, tenantId, deletedAt: null },
      select: {
        orderItem: {
          select: { order: { select: REPORT_ORDER_SELECT } },
        },
      },
    });
    const order = report?.orderItem?.order;
    if (!order) return;
    if (this.isOrderFullyPaid(order)) return;
    await this.assertReportAccessAllowed(tenantId, order);
  }

  /**
   * Whether the order whose report is being opened is fully paid — in which case
   * its reports are never credit-gated. True when it sits on a fully-paid
   * (COMPLETED) invoice, or when its own ledger reads PAID by the exact rule
   * behind the stored `Order.paymentStatus`: `derivePaymentStatus(net,
   * effectivePaid)` with `effectivePaid = paid − cancellation charge − refunds −
   * refund charges` (see `PaymentDetailsService`). A zero-value order counts as
   * paid, as it does everywhere else.
   */
  private isOrderFullyPaid(order: OrderPaymentState): boolean {
    if (order.invoiceLinks.length > 0) return true;
    const total = (key: keyof OrderPaymentState['payments'][number]) =>
      order.payments.reduce((s, p) => s + toNum(p[key]), 0);
    const net = roundToTwoDecimalPlaces(total('netAmount'));
    const effectivePaid = computeEffectivePaid(
      total('paidAmount'),
      toNum(order.cancellationCharge),
      total('refundAmount'),
      total('refundCharge'),
    );
    return derivePaymentStatus(net, effectivePaid) === PaymentStatus.PAID;
  }

  /** Core report-access gate shared by both resolvers above. */
  private async assertReportAccessAllowed(
    tenantId: string,
    input: OrderReferralRefs,
  ): Promise<void> {
    const refs = this.refs(input);
    if (refs.length === 0) return;
    const now = new Date();
    for (const ref of refs) {
      const setting = await this.settingFor(tenantId, ref);
      if (!this.hasCreditRules(setting)) continue;
      const limit = toNum(setting.creditLimitAmount);
      const days = setting.creditAllowedDays ?? 0;
      const limitOn = setting.isRestrictReportCreditLimit && limit > 0;
      const daysOn = setting.isRestrictReportCreditDays && days > 0;
      if (!limitOn && !daysOn) continue;

      const orders = await this.loadReferralOrders(tenantId, ref);
      if (limitOn) {
        const outstanding = this.outstandingOf(orders);
        if (outstanding >= limit) {
          throw new ReferralReportCreditLimitException(
            setting.settingName,
            outstanding,
            limit,
          );
        }
      }
      if (daysOn) {
        const ageDays = this.oldestUnpaidAgeDays(orders, now);
        if (ageDays > days) {
          throw new ReferralReportCreditDaysException(
            setting.settingName,
            ageDays,
            days,
          );
        }
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Non-empty referral references present on an order (order preserved). */
  private refs(input: OrderReferralRefs): ReferralRef[] {
    const out: ReferralRef[] = [];
    if (input.referralPanelId)
      out.push({ kind: 'PANEL', id: input.referralPanelId });
    if (input.referredByDoctorId)
      out.push({ kind: 'DOCTOR', id: input.referredByDoctorId });
    if (input.internalReferralId)
      out.push({ kind: 'INTERNAL', id: input.internalReferralId });
    if (input.externalReferralId)
      out.push({ kind: 'EXTERNAL', id: input.externalReferralId });
    return out;
  }

  /** The `Order` filter that matches every order billed to this referral. */
  private orderWhereFor(ref: ReferralRef): Record<string, string> {
    switch (ref.kind) {
      case 'PANEL':
        return { referralPanelId: ref.id };
      case 'DOCTOR':
        return { referredByDoctorId: ref.id };
      case 'INTERNAL':
        return { internalReferralId: ref.id };
      case 'EXTERNAL':
        return { externalReferralId: ref.id };
    }
  }

  /** Load the `ReferralPanelSettings` linked to a referral (or null). */
  private async settingFor(
    tenantId: string,
    ref: ReferralRef,
  ): Promise<ReferralPanelSettings | null> {
    const where = { id: ref.id, tenantId, deletedAt: null };
    const select = { referralPanelSettings: true } as const;
    switch (ref.kind) {
      case 'PANEL':
        return (
          (await this.prisma.referralPanel.findFirst({ where, select }))
            ?.referralPanelSettings ?? null
        );
      case 'DOCTOR':
        return (
          (await this.prisma.referralDoctor.findFirst({ where, select }))
            ?.referralPanelSettings ?? null
        );
      case 'INTERNAL':
        return (
          (await this.prisma.internalReferral.findFirst({ where, select }))
            ?.referralPanelSettings ?? null
        );
      case 'EXTERNAL':
        return (
          (await this.prisma.externalReferral.findFirst({ where, select }))
            ?.referralPanelSettings ?? null
        );
    }
  }

  /** Credit rules apply only to active Cash/Postpaid settings. */
  private hasCreditRules(
    setting: ReferralPanelSettings | null,
  ): setting is ReferralPanelSettings {
    return (
      !!setting &&
      (setting.clientType === ReferralClientType.CASH ||
        setting.clientType === ReferralClientType.POSTPAID)
    );
  }

  /**
   * A referral's active orders with their payment ledger, for balance/age.
   * Orders on a fully-paid (`COMPLETED`) invoice are excluded: their money was
   * received on the invoice ledger, which never writes `PaymentDetails`, so
   * counting them would keep a paid-up referral blocked forever. A PARTIAL
   * invoice still counts in full (Outstanding report parity); reverting a
   * receipt drops the invoice back below COMPLETED and cancelling it
   * soft-deletes the link, so either way the order's dues count again.
   */
  private loadReferralOrders(
    tenantId: string,
    ref: ReferralRef,
    excludeOrderId?: string,
  ) {
    return this.prisma.order.findMany({
      where: {
        tenantId,
        ...this.orderWhereFor(ref),
        deletedAt: null,
        status: { in: [OrderStatus.ORDER, OrderStatus.APPOINTMENT] },
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
        invoiceLinks: {
          none: {
            deletedAt: null,
            invoice: {
              deletedAt: null,
              paymentStatus: InvoicePaymentStatus.COMPLETED,
            },
          },
        },
      },
      select: {
        createdAt: true,
        payments: {
          where: { deletedAt: null },
          select: { netAmount: true, paidAmount: true },
        },
      },
    });
  }

  /** Sum of `net − paid` (floored per order) — the referral's outstanding. */
  private outstandingOf(
    orders: Array<{
      payments: Array<{
        netAmount: Prisma.Decimal | null;
        paidAmount: Prisma.Decimal | null;
      }>;
    }>,
  ): number {
    let total = 0;
    for (const o of orders) {
      const net = o.payments.reduce((s, p) => s + toNum(p.netAmount), 0);
      const paid = o.payments.reduce((s, p) => s + toNum(p.paidAmount), 0);
      total += Math.max(net - paid, 0);
    }
    return roundToTwoDecimalPlaces(total);
  }

  /** Age in days of the oldest order that still carries an outstanding balance. */
  private oldestUnpaidAgeDays(
    orders: Array<{
      createdAt: Date;
      payments: Array<{
        netAmount: Prisma.Decimal | null;
        paidAmount: Prisma.Decimal | null;
      }>;
    }>,
    now: Date,
  ): number {
    let oldest: Date | null = null;
    for (const o of orders) {
      const net = o.payments.reduce((s, p) => s + toNum(p.netAmount), 0);
      const paid = o.payments.reduce((s, p) => s + toNum(p.paidAmount), 0);
      if (net - paid > 0 && (oldest === null || o.createdAt < oldest)) {
        oldest = o.createdAt;
      }
    }
    if (oldest === null) return 0;
    return Math.floor((now.getTime() - oldest.getTime()) / DAY_MS);
  }
}
