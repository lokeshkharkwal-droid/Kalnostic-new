import { OrderStatus } from '@prisma/client';
import { roundToTwoDecimalPlaces } from '../../../common/utils';
import { computeEffectivePaid } from '../entities/order.entity';

/**
 * A single order's summed payment-ledger figures (Prisma `Decimal` values already
 * converted to `number` by the caller). These are the sums the single-order
 * receive-payment and refund paths read from a `paymentDetails.aggregate(...)`,
 * extracted here so the single and the combined (batch) paths derive the pending
 * and refundable balances with identical math.
 */
export interface LedgerAggregate {
  /** Σ `netAmount` across the order's active PAYMENT rows (the bill's net payable). */
  netAmount: number;
  /** Σ `paidAmount` across active PAYMENT rows (money collected). */
  paidAmount: number;
  /** Σ `refundAmount` across active REFUND rows (money returned to the patient). */
  refundAmount: number;
  /** Σ `refundCharge` across active REFUND rows (fee the lab retained on refunds). */
  refundCharge: number;
}

/**
 * The order's pending (still-collectable) balance: `net − effectivePaid`, where
 * effective paid folds in cancellation charge and refunds
 * ({@link computeEffectivePaid}). Rounded to 2 dp. This is the exact ceiling the
 * single receive-payment path uses for its overpayment guard, so a combined
 * pay-all validates each sub-order the same way.
 *
 * @param agg the order's summed ledger figures
 * @param cancellationCharge the order's retained cancellation fee
 * @returns the pending balance (may be negative when the order is overpaid)
 */
export function computePendingBalance(
  agg: LedgerAggregate,
  cancellationCharge: number,
): number {
  const effectivePaid = computeEffectivePaid(
    agg.paidAmount,
    cancellationCharge,
    agg.refundAmount,
    agg.refundCharge,
  );
  return roundToTwoDecimalPlaces(agg.netAmount - effectivePaid);
}

/**
 * The order's refundable balance: `effectivePaid − owed`, floored at 0. A
 * CANCELLED order owes nothing, so its whole retained amount is refundable;
 * otherwise it owes its current net (refunding below the net owed would leave an
 * active order underpaid — that is a cancellation, not a refund). This is the
 * exact ceiling the single refund path uses, reused by the combined refund-all.
 *
 * @param agg the order's summed ledger figures
 * @param cancellationCharge the order's retained cancellation fee
 * @param orderStatus the order's lifecycle status (CANCELLED ⇒ owes nothing)
 * @returns the maximum total outflow (`refund amount + refund charge`) allowed
 */
export function computeRefundableBalance(
  agg: LedgerAggregate,
  cancellationCharge: number,
  orderStatus: OrderStatus,
): number {
  const effectivePaid = computeEffectivePaid(
    agg.paidAmount,
    cancellationCharge,
    agg.refundAmount,
    agg.refundCharge,
  );
  const owed = orderStatus === OrderStatus.CANCELLED ? 0 : agg.netAmount;
  return roundToTwoDecimalPlaces(Math.max(0, effectivePaid - owed));
}
