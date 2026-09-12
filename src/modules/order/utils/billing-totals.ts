import { DiscountMode } from '@prisma/client';
import { roundToTwoDecimalPlaces } from '../../../common/utils';

/**
 * Minimal payment-row shape needed for billing totals.
 * Callers are responsible for converting Prisma Decimal values to `number` via
 * `toNum` before passing them here.
 */
export interface BillingPaymentRow {
  totalAmount: number;
  orderDiscount: number;
  netAmount: number;
  /** Persisted discount mode (null = legacy order with no saved mode). */
  orderDiscountMode: DiscountMode | null;
  /** Persisted discount value (null = legacy order). */
  orderDiscountValue: number | null;
}

/** Minimal item-row shape needed for billing totals. */
export interface BillingItemRow {
  /** The item's list / catalogue price before any discounts. */
  unitPrice: number;
  /** Per-line item discount amount already applied to this item. */
  discount: number;
}

/**
 * Compute the order-discount amount for a given mode/value against a base,
 * clamped to [0, base].
 *
 * @param mode PERCENT or AMOUNT
 * @param value the discount percentage or flat amount
 * @param base the total against which PERCENT is applied (Σ item.unitPrice)
 * @returns the discount amount, rounded to 2 decimal places, in [0, base]
 */
export function orderDiscountAmount(
  mode: DiscountMode,
  value: number,
  base: number,
): number {
  const raw =
    mode === DiscountMode.PERCENT ? (base * value) / 100 : value;
  return roundToTwoDecimalPlaces(
    Math.min(Math.max(raw, 0), Math.max(base, 0)),
  );
}

/**
 * Authoritative `{ gross, discount, net }` for an order, derived from the
 * order's persisted payment rows and item rows.
 *
 * Algorithm:
 * - `lineDiscount`  = Σ item.discount (per-item discounts).
 * - `itemsTotal`    = Σ item.unitPrice (the base for a PERCENT order discount).
 * - `storedOrderDiscount` = Σ payment.orderDiscount (what was frozen at save time).
 * - `storedNet`     = Σ payment.netAmount.
 * - If **any** payment row carries a non-null `orderDiscountMode`, the order-level
 *   discount is **recomputed** from (mode, value) against the current `itemsTotal`.
 *   This corrects a PERCENT discount that was frozen to a stale amount when a test
 *   was subsequently added or removed.
 * - If no row has a mode (legacy order), `storedOrderDiscount` is used unchanged,
 *   preserving the exact old behaviour.
 * - `net     = storedNet + storedOrderDiscount − recomputedOrderDiscount`
 *   (delta-corrects the stored net without touching charges, TDS, etc., which are
 *   already baked into the individual `netAmount` rows).
 * - `discount = lineDiscount + recomputedOrderDiscount`.
 * - `gross   = net + discount`.
 *
 * REFUND rows carry zero `totalAmount`/`orderDiscount`/`netAmount` and a null
 * `orderDiscountMode`, so they contribute nothing to the result.
 *
 * @param payments payment rows for the order (Decimal fields already converted to number)
 * @param items    item rows for the order (Decimal fields already converted to number)
 * @returns `{ gross, discount, net }` each rounded to 2 decimal places
 */
export function computeBillingTotals(
  payments: BillingPaymentRow[],
  items: BillingItemRow[],
): { gross: number; discount: number; net: number } {
  const lineDiscount = items.reduce((s, i) => s + i.discount, 0);
  const itemsTotal = items.reduce((s, i) => s + i.unitPrice, 0);
  const storedOrderDiscount = payments.reduce(
    (s, p) => s + p.orderDiscount,
    0,
  );
  const storedNet = payments.reduce((s, p) => s + p.netAmount, 0);

  // Find the first payment row that carries a persisted discount mode (only the
  // mode/value matters here — they are the same across every PAYMENT row for
  // a single order; REFUND rows have null mode).
  const snap = payments.find((p) => p.orderDiscountMode != null);
  const recomputed = snap
    ? orderDiscountAmount(
        snap.orderDiscountMode as DiscountMode,
        snap.orderDiscountValue ?? 0,
        itemsTotal,
      )
    : storedOrderDiscount;

  const net = roundToTwoDecimalPlaces(
    storedNet + storedOrderDiscount - recomputed,
  );
  const discount = roundToTwoDecimalPlaces(lineDiscount + recomputed);
  const gross = roundToTwoDecimalPlaces(net + discount);
  return { gross, discount, net };
}
