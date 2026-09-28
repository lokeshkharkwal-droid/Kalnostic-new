import { OrderStatus } from '@prisma/client';
import { roundToTwoDecimalPlaces } from '../../../common/utils';

/**
 * Display label for a bill's status — exactly what the Registration → Billings
 * list shows in its Status column. Used by the `{bill_status}` /
 * `{payment_status}` print tags so a printed bill reads the same as the screen,
 * instead of the raw stored `paymentStatus` enum (which ignores cancellation and
 * refunds: a cancelled order would still print `PARTIALLY_PAID`).
 *
 * Mirrors the frontend `deriveStatus` in
 * `kaltros-fe/src/pages/Registration/Billings/utils/mapBill.ts` rule for rule —
 * keep the two in lockstep.
 *
 * @param orderStatus the order's lifecycle status (`CANCELLED` wins outright)
 * @param net authoritative net payable (`OrderWithRelations.netAmount`)
 * @param effectivePaid money retained after cancellation/refund deductions
 *   ({@link computeEffectivePaid})
 * @param refunded summed `refundAmount` across the order's REFUND ledger rows
 * @returns one of `Cancelled`, `Partially Refunded`, `Require Refund`,
 *   `Fully Refunded`, `Paid`, `Not Paid`, `Partially Paid`
 */
export function billStatusLabel(
  orderStatus: OrderStatus,
  net: number,
  effectivePaid: number,
  refunded: number,
): string {
  if (orderStatus === OrderStatus.CANCELLED) return 'Cancelled';

  // Rounded to 2dp so float noise can't flip a settled order to Require Refund.
  const balance = roundToTwoDecimalPlaces(net - effectivePaid);
  const hasRefund = refunded > 0;

  // Customer is still owed money back (overpaid vs the current net).
  if (balance < 0) return hasRefund ? 'Partially Refunded' : 'Require Refund';

  // A refund was paid out and the order is now exactly settled at its net.
  if (hasRefund && balance === 0) return 'Fully Refunded';

  // Pure payment states. Nothing owed (net ≤ 0) ⇒ settled — covers Generate
  // Bill = No orders (payable 0, paid 0) and fully-discounted orders.
  if (net <= 0) return 'Paid';
  if (effectivePaid <= 0) return 'Not Paid';
  if (balance === 0) return 'Paid';
  return 'Partially Paid';
}
