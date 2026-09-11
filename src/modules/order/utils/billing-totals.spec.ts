import { DiscountMode } from '@prisma/client';
import {
  computeBillingTotals,
  orderDiscountAmount,
  type BillingPaymentRow,
  type BillingItemRow,
} from './billing-totals';

// ---------------------------------------------------------------------------
// orderDiscountAmount
// ---------------------------------------------------------------------------
describe('orderDiscountAmount', () => {
  it('PERCENT: computes percentage of base and rounds to 2dp', () => {
    // 10% of 700 = 70
    expect(orderDiscountAmount(DiscountMode.PERCENT, 10, 700)).toBe(70);
  });

  it('AMOUNT: returns the value directly', () => {
    expect(orderDiscountAmount(DiscountMode.AMOUNT, 150, 700)).toBe(150);
  });

  it('clamps AMOUNT discount to base when it exceeds base', () => {
    // discount 1000 > base 700 → capped at 700
    expect(orderDiscountAmount(DiscountMode.AMOUNT, 1000, 700)).toBe(700);
  });

  it('clamps PERCENT discount to 0 when value is negative', () => {
    expect(orderDiscountAmount(DiscountMode.PERCENT, -5, 700)).toBe(0);
  });

  it('rounds PERCENT result to 2 decimal places', () => {
    // 7.5% of 333.33 = 24.99975 → 25.00
    expect(orderDiscountAmount(DiscountMode.PERCENT, 7.5, 333.33)).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// computeBillingTotals — helpers
// ---------------------------------------------------------------------------

/** Build a payment row with optional mode/value (defaults to legacy null). */
function pay(
  totalAmount: number,
  orderDiscount: number,
  netAmount: number,
  _paidAmount = 0, // not part of BillingPaymentRow; kept for readability of test data
  opts?: {
    orderDiscountMode?: DiscountMode;
    orderDiscountValue?: number;
  },
): BillingPaymentRow {
  return {
    totalAmount,
    orderDiscount,
    netAmount,
    orderDiscountMode: opts?.orderDiscountMode ?? null,
    orderDiscountValue: opts?.orderDiscountValue ?? null,
  };
}

/** Build an item row. */
function item(unitPrice: number, discount = 0): BillingItemRow {
  return { unitPrice, discount };
}

// ---------------------------------------------------------------------------
// 1. Legacy orders (no mode/value): must exactly match old formula
//    discount = Σ orderDiscount + Σ lineDiscount ; net = Σ netAmount ; gross = net + discount
// ---------------------------------------------------------------------------
describe('computeBillingTotals — legacy (no mode/value)', () => {
  it('basic single-payment, no line discounts', () => {
    // gross = net + discount = 800 + 100 = 900 ✓
    const result = computeBillingTotals(
      [pay(900, 100, 800)],
      [item(900)],
    );
    expect(result.net).toBe(800);
    expect(result.discount).toBe(100);
    expect(result.gross).toBe(900);
  });

  it('includes line-item discounts in discount', () => {
    // order discount 100, line discount 50 → total discount 150
    // net = 750, gross = 900
    const result = computeBillingTotals(
      [pay(900, 100, 800)],
      [item(1000, 50)], // unitPrice 1000 but we have line discount 50
    );
    expect(result.discount).toBe(150); // 100 orderDiscount + 50 lineDiscount
    expect(result.net).toBe(800);    // unchanged — Σ netAmount (already includes line discount)
    expect(result.gross).toBe(950);  // net + discount
  });

  it('multi-payment rows are summed', () => {
    // Two payment rows — no mode/value (legacy split)
    const result = computeBillingTotals(
      [pay(600, 50, 550), pay(300, 50, 250)],
      [item(900)],
    );
    // storedOrderDiscount = 100, storedNet = 800, lineDiscount = 0
    expect(result.discount).toBe(100);
    expect(result.net).toBe(800);
    expect(result.gross).toBe(900);
  });

  it('zero-value order (fully discounted)', () => {
    const result = computeBillingTotals(
      [pay(500, 500, 0)],
      [item(500)],
    );
    expect(result.net).toBe(0);
    expect(result.discount).toBe(500);
    expect(result.gross).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 2. PERCENT order discount recomputed against current items total
//    Scenario: items total dropped 1000→700 (test removed); snapshot shows
//    mode=PERCENT value=10; stored orderDiscount was frozen at 100 (10% of 1000).
//    Expected: recomputed = 10% of 700 = 70; net = 600 + 100 − 70 = 630; gross = 700.
// ---------------------------------------------------------------------------
describe('computeBillingTotals — PERCENT recomputation', () => {
  it('corrects a stale frozen PERCENT discount after item removal', () => {
    const result = computeBillingTotals(
      [
        pay(1000, 100, 600, 0, {
          orderDiscountMode: DiscountMode.PERCENT,
          orderDiscountValue: 10,
        }),
      ],
      [item(700)], // items total 700 (one test removed)
    );
    expect(result.discount).toBe(70);   // recomputed: 10% of 700
    expect(result.net).toBe(630);       // 600 + (100 − 70)
    expect(result.gross).toBe(700);     // net + discount = 630 + 70
  });

  it('PERCENT discount with line discounts included in total discount', () => {
    // items: unitPrice 700, lineDiscount 50
    // PERCENT 10% of 700 = 70 (itemsTotal is Σ unitPrice, not reduced by line discounts)
    // storedOrderDiscount = 100, storedNet = 600
    // recomputed = 70, delta = 100-70 = 30, net = 600 + 30 = 630
    // discount = lineDiscount(50) + recomputed(70) = 120
    // gross = 630 + 120 = 750
    const result = computeBillingTotals(
      [
        pay(1000, 100, 600, 0, {
          orderDiscountMode: DiscountMode.PERCENT,
          orderDiscountValue: 10,
        }),
      ],
      [item(700, 50)],
    );
    expect(result.discount).toBe(120);  // 50 line + 70 order
    expect(result.net).toBe(630);
    expect(result.gross).toBe(750);
  });

  it('PERCENT unchanged when items total matches original (mode/value still present)', () => {
    // items total = 1000 (same as base), PERCENT 10% → recomputed = 100 = stored → no delta
    const result = computeBillingTotals(
      [
        pay(1000, 100, 900, 0, {
          orderDiscountMode: DiscountMode.PERCENT,
          orderDiscountValue: 10,
        }),
      ],
      [item(1000)],
    );
    expect(result.discount).toBe(100);
    expect(result.net).toBe(900);
    expect(result.gross).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 3. AMOUNT order discount — recomputed = value (clamped), no change when stored matches
// ---------------------------------------------------------------------------
describe('computeBillingTotals — AMOUNT discount', () => {
  it('AMOUNT: when stored matches recomputed, net is unchanged', () => {
    const result = computeBillingTotals(
      [
        pay(1000, 150, 850, 0, {
          orderDiscountMode: DiscountMode.AMOUNT,
          orderDiscountValue: 150,
        }),
      ],
      [item(1000)],
    );
    expect(result.discount).toBe(150);
    expect(result.net).toBe(850);
    expect(result.gross).toBe(1000);
  });

  it('AMOUNT: when items total drops below discount, discount is clamped to items total', () => {
    // items total now 100, AMOUNT discount 150 → clamped to 100
    // stored orderDiscount = 150, storedNet = 850
    // recomputed = 100, net = 850 + (150 − 100) = 900, discount = 100, gross = 1000
    const result = computeBillingTotals(
      [
        pay(1000, 150, 850, 0, {
          orderDiscountMode: DiscountMode.AMOUNT,
          orderDiscountValue: 150,
        }),
      ],
      [item(100)],
    );
    expect(result.discount).toBe(100);
    expect(result.net).toBe(900);
    expect(result.gross).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 4. REFUND-like rows (all zero, mode null) don't change the result
// ---------------------------------------------------------------------------
describe('computeBillingTotals — REFUND rows are neutral', () => {
  it('REFUND row with zero totals and null mode does not affect totals', () => {
    // Normal payment row
    const normalPay = pay(1000, 100, 900, 900, {
      orderDiscountMode: DiscountMode.AMOUNT,
      orderDiscountValue: 100,
    });
    // Refund row — all zeros, mode null (as described in spec)
    const refundPay = pay(0, 0, 0, 0);

    const withRefund = computeBillingTotals(
      [normalPay, refundPay],
      [item(1000)],
    );
    const withoutRefund = computeBillingTotals([normalPay], [item(1000)]);

    expect(withRefund.gross).toBe(withoutRefund.gross);
    expect(withRefund.discount).toBe(withoutRefund.discount);
    expect(withRefund.net).toBe(withoutRefund.net);
  });
});

// ---------------------------------------------------------------------------
// 5. Edge cases
// ---------------------------------------------------------------------------
describe('computeBillingTotals — edge cases', () => {
  it('no payments, no items → all zeros', () => {
    const result = computeBillingTotals([], []);
    expect(result.gross).toBe(0);
    expect(result.discount).toBe(0);
    expect(result.net).toBe(0);
  });

  it('gross = net + discount invariant holds across all scenarios', () => {
    const cases: Array<{
      payments: BillingPaymentRow[];
      items: BillingItemRow[];
    }> = [
      // Legacy
      { payments: [pay(900, 100, 800)], items: [item(900)] },
      // With line discounts
      { payments: [pay(900, 100, 750)], items: [item(900, 50)] },
      // PERCENT
      {
        payments: [
          pay(1000, 100, 600, 0, {
            orderDiscountMode: DiscountMode.PERCENT,
            orderDiscountValue: 10,
          }),
        ],
        items: [item(700)],
      },
      // AMOUNT
      {
        payments: [
          pay(1000, 150, 850, 0, {
            orderDiscountMode: DiscountMode.AMOUNT,
            orderDiscountValue: 150,
          }),
        ],
        items: [item(1000)],
      },
    ];

    for (const { payments, items } of cases) {
      const r = computeBillingTotals(payments, items);
      // Allow for floating point rounding tolerance of 0.01
      expect(Math.abs(r.gross - (r.net + r.discount))).toBeLessThanOrEqual(
        0.01,
      );
    }
  });
});
