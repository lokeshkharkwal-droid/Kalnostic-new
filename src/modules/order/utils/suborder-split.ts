import { DiscountMode, OrderSection } from '@prisma/client';
import { roundToTwoDecimalPlaces } from '../../../common/utils';

/**
 * A combined (diagnostic + radiology) order is persisted as a PARENT order with
 * two CHILD sub-orders. The money the operator entered once at the order level
 * (payable, order-level discount, each partial payment) must be **split** across
 * the two sub-orders proportionally so each child carries its own independent
 * ledger whose parts sum back to the whole.
 *
 * This module is the single source of truth for that split (the backend applies
 * it on create; the frontend mirrors the same math for display only).
 *
 * **Weighting.** Each section's share is its `subGross − subLineDiscount` (the
 * post-line-discount value of that section's items) over the order total. Every
 * money field is allocated by this weight, EXCEPT `visitingCharges`, which is a
 * home-visit (diagnostic) concept and is assigned wholly to the DIAGNOSTICS
 * child.
 *
 * **Rounding.** Each allocated field is rounded to 2 dp and the LAST section in
 * a fixed order (DIAGNOSTICS, then RADIOLOGY) absorbs the rounding remainder, so
 * the parts always sum back to the original to the paisa.
 *
 * **Order-level discount mode.** Carried onto each child so the authoritative
 * read path (`computeBillingTotals`) re-derives the per-child discount: for
 * PERCENT the same percentage is kept (so each child discounts its own items);
 * for AMOUNT the allocated rupee amount is stored as the child's value.
 */

/** Fixed section order — the last one absorbs each field's rounding remainder. */
const SECTION_ORDER: OrderSection[] = [
  OrderSection.DIAGNOSTICS,
  OrderSection.RADIOLOGY,
];

/** One order item reduced to what the split needs: its section + resolved money. */
export interface SplitItemInput {
  /** DIAGNOSTICS for lab/direct items, RADIOLOGY for radiology items. */
  section: OrderSection;
  /** The item's resolved list/direct unit price (rupees). */
  unitPrice: number;
  /** The per-line discount amount already applied to this item (rupees). */
  discount: number;
}

/** The whole-order money fields on an inbound payment row (undefined → 0). */
export interface PaymentMoneyInput {
  totalAmount?: number;
  orderDiscount?: number;
  orderDiscountMode?: DiscountMode | null;
  orderDiscountValue?: number | null;
  netDiscount?: number;
  visitingCharges?: number;
  netAmount?: number;
  deductFromWallet?: number;
  deductFromPoints?: number;
  tdsDeduction?: number;
  payableAmount?: number;
  paidAmount?: number;
  remainingBalance?: number;
}

/** A single payment row's money allocated to one section. */
export interface SplitPaymentMoney {
  totalAmount: number;
  orderDiscount: number;
  orderDiscountMode: DiscountMode | null;
  orderDiscountValue: number | null;
  netDiscount: number;
  visitingCharges: number;
  netAmount: number;
  deductFromWallet: number;
  deductFromPoints: number;
  tdsDeduction: number;
  payableAmount: number;
  paidAmount: number;
  remainingBalance: number;
}

/** The per-section split result: the section, its weight, and one row per input payment. */
export interface SectionPaymentSplit {
  section: OrderSection;
  /** This section's share of the order (0..1). */
  weight: number;
  /** Allocated money, one entry per input payment row (same order as input). */
  payments: SplitPaymentMoney[];
}

/**
 * Allocate `total` across `weights` (same length/order as the sections), rounding
 * each part to 2 dp and giving the LAST entry the remainder so the parts sum to
 * `total` exactly.
 *
 * @param total the whole-order amount to split
 * @param weights each section's share (need not sum to exactly 1 — normalised here)
 * @returns one allocated amount per weight, in the same order
 */
export function allocateByWeight(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  const safe = sumW > 0 ? weights : weights.map(() => 1); // equal split if no weight
  const safeSum = sumW > 0 ? sumW : n;
  const parts: number[] = [];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const v = roundToTwoDecimalPlaces((total * (safe[i] ?? 0)) / safeSum);
    parts.push(v);
    acc += v;
  }
  parts.push(roundToTwoDecimalPlaces(total - acc)); // last absorbs remainder
  return parts;
}

/**
 * Distribute `total` across buckets by `weight`, but never allocate more than a
 * bucket's `cap` (its remaining balance). Overflow from a capped bucket spills to
 * the still-uncapped buckets in proportion to their weight, iterating until the
 * whole `total` is placed or every bucket is at its cap. Each allocation is
 * rounded to 2 dp; any residual rounding paisa lands on the uncapped bucket with
 * the largest remaining headroom, so the parts sum back to `min(total, Σ cap)`.
 *
 * This is the authoritative **"creation-ratio, capped at balance"** rule for
 * auto-distributing a combined order's partial payment across its sub-orders:
 * `weight` is each sub-order's section share (its net), `cap` is its remaining
 * balance. The frontend mirrors this for a live preview; the backend value wins.
 *
 * @param total the amount to distribute (capped at `Σ cap`; negatives → 0)
 * @param buckets each bucket's distribution `weight` and `cap` (max allocatable)
 * @returns one allocated amount per bucket, in input order; each `≤` its cap
 */
export function distributeCappedByWeight(
  total: number,
  buckets: Array<{ weight: number; cap: number }>,
): number[] {
  const n = buckets.length;
  const alloc = new Array<number>(n).fill(0);
  if (n === 0) return alloc;
  const caps = buckets.map((b) => Math.max(0, roundToTwoDecimalPlaces(b.cap)));
  const weights = buckets.map((b) => Math.max(0, b.weight));
  const capSum = caps.reduce((a, b) => a + b, 0);
  let remaining = roundToTwoDecimalPlaces(Math.min(Math.max(0, total), capSum));

  // Each pass allocates `remaining` by weight among buckets with headroom left,
  // caps each, and carries the overflow to the next pass. Bounded by bucket count.
  for (let pass = 0; pass < n && remaining > 0.005; pass++) {
    const openIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if ((caps[i] ?? 0) - (alloc[i] ?? 0) > 0.005) openIdx.push(i);
    }
    if (openIdx.length === 0) break;
    const wSum = openIdx.reduce((s, i) => s + (weights[i] ?? 0), 0);
    let placed = 0;
    for (const i of openIdx) {
      const w = wSum > 0 ? (weights[i] ?? 0) / wSum : 1 / openIdx.length;
      const want = roundToTwoDecimalPlaces(remaining * w);
      const headroom = roundToTwoDecimalPlaces(
        (caps[i] ?? 0) - (alloc[i] ?? 0),
      );
      // Also cap at what's left to place this pass, so independent rounding on
      // several buckets can never overshoot the total (keeps Σ parts ≤ total).
      const left = roundToTwoDecimalPlaces(remaining - placed);
      const give = Math.min(want, headroom, Math.max(0, left));
      alloc[i] = roundToTwoDecimalPlaces((alloc[i] ?? 0) + give);
      placed = roundToTwoDecimalPlaces(placed + give);
    }
    remaining = roundToTwoDecimalPlaces(remaining - placed);
    if (placed <= 0.005) break; // only rounding dust left — stop
  }

  // Residual paisa (rounding) → the bucket with the most remaining headroom.
  if (remaining > 0.005) {
    let best = -1;
    let bestHeadroom = 0;
    for (let i = 0; i < n; i++) {
      const headroom = roundToTwoDecimalPlaces(
        (caps[i] ?? 0) - (alloc[i] ?? 0),
      );
      if (headroom > bestHeadroom) {
        bestHeadroom = headroom;
        best = i;
      }
    }
    if (best >= 0) {
      alloc[best] = roundToTwoDecimalPlaces(
        (alloc[best] ?? 0) + Math.min(remaining, bestHeadroom),
      );
    }
  }
  return alloc;
}

/**
 * Compute each present section's base (`subGross − subLineDiscount`) from the
 * order's items.
 *
 * @param items the order's items, each tagged with its section + resolved price
 * @returns the sections present (in {@link SECTION_ORDER}) with their base value
 */
function sectionBases(
  items: SplitItemInput[],
): Array<{ section: OrderSection; base: number }> {
  return SECTION_ORDER.filter((section) =>
    items.some((it) => it.section === section),
  ).map((section) => {
    const slice = items.filter((it) => it.section === section);
    const subGross = slice.reduce((s, it) => s + it.unitPrice, 0);
    const subLineDiscount = slice.reduce((s, it) => s + it.discount, 0);
    return { section, base: Math.max(0, subGross - subLineDiscount) };
  });
}

/**
 * Split an order's whole-order payment rows across its sub-order sections.
 *
 * Only the sections actually present among `items` are returned. When a single
 * section is present the order is not combined and the caller should not split —
 * but this still returns that one section at weight 1 for safety.
 *
 * @param items the order's items, each tagged with its section + resolved money
 * @param payments the whole-order payment rows (as entered once at order level)
 * @param opts.paidSplitBySection a MANUAL per-section paid allocation (rupees) —
 *   when provided, the `paidAmount` field is distributed by these section shares
 *   instead of the proportional section weights (every OTHER field still splits
 *   proportionally). The operator sets this on `/registration/create` to control
 *   how a PARTIAL payment lands on each sub-order; the values must sum to the
 *   total paid across `payments` (validated by the caller), so each section's
 *   summed `paidAmount` equals its manual share regardless of how many payment
 *   rows there are.
 * @returns one {@link SectionPaymentSplit} per present section
 */
export function splitPaymentsBySection(
  items: SplitItemInput[],
  payments: PaymentMoneyInput[],
  opts?: { paidSplitBySection?: Partial<Record<OrderSection, number>> },
): SectionPaymentSplit[] {
  const bases = sectionBases(items);
  const sections = bases.map((b) => b.section);
  const weights = bases.map((b) => b.base);
  const totalBase = weights.reduce((a, b) => a + b, 0);

  // Manual paid-split weights (index-aligned with `sections`), or null to keep
  // the default proportional split for `paidAmount` too.
  const paidWeights = opts?.paidSplitBySection
    ? sections.map((sec) => Math.max(0, opts.paidSplitBySection?.[sec] ?? 0))
    : null;

  // Per-field allocations across sections (index-aligned with `sections`).
  const diagIndex = sections.indexOf(OrderSection.DIAGNOSTICS);

  const result: SectionPaymentSplit[] = sections.map((section, i) => ({
    section,
    weight: totalBase > 0 ? (weights[i] ?? 0) / totalBase : 1 / sections.length,
    payments: [],
  }));

  for (const p of payments) {
    const alloc = (total: number) => allocateByWeight(total, weights);
    // visitingCharges is a home-visit (diagnostic) concept — all to DIAGNOSTICS.
    const visitAlloc = sections.map((_, i) =>
      i === diagIndex ? (p.visitingCharges ?? 0) : 0,
    );

    const totalAmount = alloc(p.totalAmount ?? 0);
    const orderDiscount = alloc(p.orderDiscount ?? 0);
    const netDiscount = alloc(p.netDiscount ?? 0);
    const netAmount = alloc(p.netAmount ?? 0);
    const deductFromWallet = alloc(p.deductFromWallet ?? 0);
    const deductFromPoints = alloc(p.deductFromPoints ?? 0);
    const tdsDeduction = alloc(p.tdsDeduction ?? 0);
    const payableAmount = alloc(p.payableAmount ?? 0);
    // paidAmount follows the MANUAL split weights when provided (so each
    // sub-order records exactly the operator-chosen share of this partial
    // payment), else the default proportional split.
    const paidAmount = paidWeights
      ? allocateByWeight(p.paidAmount ?? 0, paidWeights)
      : alloc(p.paidAmount ?? 0);
    const remainingBalance = alloc(p.remainingBalance ?? 0);

    sections.forEach((_, i) => {
      // PERCENT order discounts keep the same percentage per child (so each
      // child discounts its own item total); AMOUNT discounts store the
      // allocated rupee amount as the child's value.
      const mode = p.orderDiscountMode ?? null;
      const value =
        mode === DiscountMode.PERCENT
          ? (p.orderDiscountValue ?? null)
          : mode === DiscountMode.AMOUNT
            ? (orderDiscount[i] ?? 0)
            : null;
      result[i]?.payments.push({
        totalAmount: totalAmount[i] ?? 0,
        orderDiscount: orderDiscount[i] ?? 0,
        orderDiscountMode: mode,
        orderDiscountValue: value,
        netDiscount: netDiscount[i] ?? 0,
        visitingCharges: visitAlloc[i] ?? 0,
        netAmount: netAmount[i] ?? 0,
        deductFromWallet: deductFromWallet[i] ?? 0,
        deductFromPoints: deductFromPoints[i] ?? 0,
        tdsDeduction: tdsDeduction[i] ?? 0,
        payableAmount: payableAmount[i] ?? 0,
        paidAmount: paidAmount[i] ?? 0,
        remainingBalance: remainingBalance[i] ?? 0,
      });
    });
  }

  return result;
}
