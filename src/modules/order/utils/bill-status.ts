import { BillStatus, OrderStatus, Prisma } from '@prisma/client';
import { roundToTwoDecimalPlaces, toNum } from '../../../common/utils';
import { computeEffectivePaid } from '../entities/order.entity';
import { computeBillingTotals } from './billing-totals';

/**
 * The single billing Status of an order — the value the Registration/Finance →
 * Billings list renders in its Status column AND matches against its Status
 * filter, so the two can never disagree. Persisted on `Order.billStatus` by
 * {@link recomputeBillStatusInTx}.
 *
 * A strict, non-overlapping priority ladder (first match wins):
 * 1. Order lifecycle — `CANCELLED` wins outright (never also Paid/Refunded).
 * 2. Refund — overpaid vs the current net (`balance < 0`) ⇒ `PARTIALLY_REFUNDED`
 *    once part of the surplus is paid back, else `REQUIRE_REFUND`; a refund paid
 *    out and the order now settled exactly at its net ⇒ `FULLY_REFUNDED`.
 * 3. Payment / outstanding — nothing owed (`net ≤ 0`, e.g. Generate Bill = No or
 *    100% discount) ⇒ `PAID`; nothing retained ⇒ `NOT_PAID`; settled ⇒ `PAID`;
 *    otherwise `PARTIALLY_PAID`.
 *
 * @param orderStatus the order's lifecycle status
 * @param net authoritative net payable ({@link computeBillingTotals})
 * @param effectivePaid money retained after cancellation/refund deductions
 *   ({@link computeEffectivePaid})
 * @param refunded summed `refundAmount` across the order's REFUND ledger rows
 */
export function deriveBillStatus(
  orderStatus: OrderStatus,
  net: number,
  effectivePaid: number,
  refunded: number,
): BillStatus {
  if (orderStatus === OrderStatus.CANCELLED) return BillStatus.CANCELLED;

  // Rounded to 2dp so float noise can't flip a settled order to Require Refund.
  const balance = roundToTwoDecimalPlaces(net - effectivePaid);
  const hasRefund = refunded > 0;

  if (balance < 0) {
    return hasRefund
      ? BillStatus.PARTIALLY_REFUNDED
      : BillStatus.REQUIRE_REFUND;
  }
  if (hasRefund && balance === 0) return BillStatus.FULLY_REFUNDED;

  if (net <= 0) return BillStatus.PAID;
  if (effectivePaid <= 0) return BillStatus.NOT_PAID;
  if (balance === 0) return BillStatus.PAID;
  return BillStatus.PARTIALLY_PAID;
}

/** Display label per {@link BillStatus} — identical to the frontend's labels. */
export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  [BillStatus.NOT_PAID]: 'Not Paid',
  [BillStatus.PARTIALLY_PAID]: 'Partially Paid',
  [BillStatus.PAID]: 'Paid',
  [BillStatus.CANCELLED]: 'Cancelled',
  [BillStatus.REQUIRE_REFUND]: 'Require Refund',
  [BillStatus.PARTIALLY_REFUNDED]: 'Partially Refunded',
  [BillStatus.FULLY_REFUNDED]: 'Fully Refunded',
};

/**
 * Display label for a bill's status — the label form of {@link deriveBillStatus}.
 * Used by the `{bill_status}` / `{payment_status}` print tags so a printed bill
 * reads the same as the Billings screen.
 * @returns one of `Cancelled`, `Partially Refunded`, `Require Refund`,
 *   `Fully Refunded`, `Paid`, `Not Paid`, `Partially Paid`
 */
export function billStatusLabel(
  orderStatus: OrderStatus,
  net: number,
  effectivePaid: number,
  refunded: number,
): string {
  return BILL_STATUS_LABEL[
    deriveBillStatus(orderStatus, net, effectivePaid, refunded)
  ];
}

/**
 * Recompute and persist `Order.billStatus` from the order's current state, inside
 * the caller's transaction. Inputs are exactly those the Billings list row is
 * built from (`OrderService.billingRollups`): the item-based net from
 * {@link computeBillingTotals}, gross paid / refunds / refund charges summed over
 * the active ledger, and the order's cancellation charge. Call it after EVERY
 * write that changes the order's status, items, discount or payment ledger.
 * @param tx active tenant-scoped transaction client
 * @param tenantId tenant scope
 * @param orderId the order to recompute
 * @returns the stored status (null if the order doesn't resolve)
 */
export async function recomputeBillStatusInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
): Promise<BillStatus | null> {
  const order = await tx.order.findFirst({
    where: { id: orderId, tenantId },
    select: {
      status: true,
      cancellationCharge: true,
      payments: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          totalAmount: true,
          orderDiscount: true,
          netAmount: true,
          orderDiscountMode: true,
          orderDiscountValue: true,
          paidAmount: true,
          refundAmount: true,
          refundCharge: true,
        },
      },
      items: {
        where: { deletedAt: null },
        select: { unitPrice: true, discount: true },
      },
    },
  });
  if (!order) return null;

  const { payments } = order;
  const { net } = computeBillingTotals(
    payments.map((p) => ({
      totalAmount: toNum(p.totalAmount),
      orderDiscount: toNum(p.orderDiscount),
      netAmount: toNum(p.netAmount),
      orderDiscountMode: p.orderDiscountMode ?? null,
      orderDiscountValue:
        p.orderDiscountValue != null ? toNum(p.orderDiscountValue) : null,
    })),
    order.items.map((it) => ({
      unitPrice: toNum(it.unitPrice),
      discount: toNum(it.discount),
    })),
  );
  const sum = (pick: (p: (typeof payments)[number]) => Prisma.Decimal) =>
    payments.reduce((s, p) => s + toNum(pick(p)), 0);
  const refunded = sum((p) => p.refundAmount);
  const effectivePaid = computeEffectivePaid(
    sum((p) => p.paidAmount),
    toNum(order.cancellationCharge),
    refunded,
    sum((p) => p.refundCharge),
  );
  const billStatus = deriveBillStatus(
    order.status,
    net,
    effectivePaid,
    refunded,
  );
  await tx.order.update({ where: { id: orderId }, data: { billStatus } });
  return billStatus;
}
