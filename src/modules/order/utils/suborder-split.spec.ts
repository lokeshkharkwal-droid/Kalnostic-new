import { DiscountMode, OrderSection } from '@prisma/client';
import {
  allocateByWeight,
  distributeCappedByWeight,
  splitPaymentsBySection,
  SplitItemInput,
} from './suborder-split';

describe('allocateByWeight', () => {
  it('splits by weight and makes the parts sum to the whole', () => {
    const parts = allocateByWeight(1000, [0.6, 0.4]);
    expect(parts).toEqual([600, 400]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('gives the last entry the rounding remainder', () => {
    // 333 on 0.6 / 0.4 → 199.80 and 133.20 (last absorbs the remainder)
    const parts = allocateByWeight(333, [0.6, 0.4]);
    expect(parts[0]!).toBe(199.8);
    expect(parts[1]!).toBe(133.2);
    expect(parts[0]! + parts[1]!).toBe(333);
  });

  it('splits equally when no weight is present', () => {
    expect(allocateByWeight(100, [0, 0])).toEqual([50, 50]);
  });

  it('handles a single section', () => {
    expect(allocateByWeight(250, [1])).toEqual([250]);
  });
});

describe('distributeCappedByWeight', () => {
  it('distributes by weight when nothing is capped', () => {
    // 500 on a 1400/600 (70/30) weighting → 350 / 150
    const parts = distributeCappedByWeight(500, [
      { weight: 1400, cap: 1400 },
      { weight: 600, cap: 600 },
    ]);
    expect(parts).toEqual([350, 150]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(500);
  });

  it('caps a bucket at its balance and spills the overflow to the other', () => {
    // 70% of 1000 = 700 would exceed the diagnostic cap of 100 → cap at 100 and
    // spill the remaining 900 to radiology.
    const parts = distributeCappedByWeight(1000, [
      { weight: 1400, cap: 100 },
      { weight: 600, cap: 2000 },
    ]);
    expect(parts[0]!).toBe(100);
    expect(parts[1]!).toBe(900);
    expect(parts[0]! + parts[1]!).toBe(1000);
  });

  it('never allocates more than the total of the caps', () => {
    const parts = distributeCappedByWeight(1000, [
      { weight: 1, cap: 300 },
      { weight: 1, cap: 200 },
    ]);
    expect(parts).toEqual([300, 200]); // only 500 is allocatable
  });

  it('splits by weight only up to each cap (both partially filled)', () => {
    const parts = distributeCappedByWeight(400, [
      { weight: 1, cap: 1000 },
      { weight: 1, cap: 1000 },
    ]);
    expect(parts).toEqual([200, 200]);
  });

  it('floors a negative total at 0', () => {
    expect(
      distributeCappedByWeight(-50, [
        { weight: 1, cap: 100 },
        { weight: 1, cap: 100 },
      ]),
    ).toEqual([0, 0]);
  });

  it('keeps the parts summing to the total with rounding (odd split)', () => {
    const parts = distributeCappedByWeight(333.33, [
      { weight: 1, cap: 1000 },
      { weight: 1, cap: 1000 },
    ]);
    expect(parts[0]! + parts[1]!).toBeCloseTo(333.33, 2);
    expect(parts[0]!).toBeLessThanOrEqual(1000);
    expect(parts[1]!).toBeLessThanOrEqual(1000);
  });
});

describe('splitPaymentsBySection', () => {
  const items: SplitItemInput[] = [
    { section: OrderSection.DIAGNOSTICS, unitPrice: 600, discount: 0 },
    { section: OrderSection.RADIOLOGY, unitPrice: 400, discount: 0 },
  ];

  it('derives 60/40 weights from item gross', () => {
    const split = splitPaymentsBySection(items, []);
    expect(split.map((s) => s.section)).toEqual([
      OrderSection.DIAGNOSTICS,
      OrderSection.RADIOLOGY,
    ]);
    expect(split[0]!.weight).toBeCloseTo(0.6);
    expect(split[1]!.weight).toBeCloseTo(0.4);
  });

  it('splits a full payment 600/400 and sums back to the whole', () => {
    const split = splitPaymentsBySection(items, [
      {
        totalAmount: 1000,
        netAmount: 1000,
        payableAmount: 1000,
        paidAmount: 1000,
      },
    ]);
    const diag = split[0]!.payments[0]!;
    const rad = split[1]!.payments[0]!;
    expect(diag.paidAmount).toBe(600);
    expect(rad.paidAmount).toBe(400);
    expect(diag.payableAmount + rad.payableAmount).toBe(1000);
  });

  it('splits a ₹500 partial payment 300/200', () => {
    const split = splitPaymentsBySection(items, [{ paidAmount: 500 }]);
    expect(split[0]!.payments[0]!.paidAmount).toBe(300);
    expect(split[1]!.payments[0]!.paidAmount).toBe(200);
  });

  it('keeps a PERCENT order discount percentage on each child', () => {
    const split = splitPaymentsBySection(items, [
      {
        orderDiscount: 100,
        orderDiscountMode: DiscountMode.PERCENT,
        orderDiscountValue: 10,
      },
    ]);
    const diag = split[0]!.payments[0]!;
    const rad = split[1]!.payments[0]!;
    expect(diag.orderDiscountMode).toBe(DiscountMode.PERCENT);
    expect(diag.orderDiscountValue).toBe(10);
    expect(rad.orderDiscountValue).toBe(10);
    // Allocated rupee amount still splits 60/40 and sums to the whole.
    expect(diag.orderDiscount).toBe(60);
    expect(rad.orderDiscount).toBe(40);
    expect(diag.orderDiscount + rad.orderDiscount).toBe(100);
  });

  it('stores the allocated amount as the value for an AMOUNT order discount', () => {
    const split = splitPaymentsBySection(items, [
      {
        orderDiscount: 100,
        orderDiscountMode: DiscountMode.AMOUNT,
        orderDiscountValue: 100,
      },
    ]);
    const diag = split[0]!.payments[0]!;
    expect(diag.orderDiscountMode).toBe(DiscountMode.AMOUNT);
    expect(diag.orderDiscountValue).toBe(60);
    expect(diag.orderDiscount).toBe(60);
  });

  it('assigns visiting charges entirely to the diagnostic child', () => {
    const split = splitPaymentsBySection(items, [{ visitingCharges: 150 }]);
    expect(split[0]!.payments[0]!.visitingCharges).toBe(150);
    expect(split[1]!.payments[0]!.visitingCharges).toBe(0);
  });

  it('accounts for per-line discounts in the weights', () => {
    const withLineDiscount: SplitItemInput[] = [
      { section: OrderSection.DIAGNOSTICS, unitPrice: 600, discount: 100 }, // base 500
      { section: OrderSection.RADIOLOGY, unitPrice: 400, discount: 0 }, // base 400
    ];
    const split = splitPaymentsBySection(withLineDiscount, []);
    expect(split[0]!.weight).toBeCloseTo(500 / 900);
    expect(split[1]!.weight).toBeCloseTo(400 / 900);
  });

  it('honours a manual paid split instead of the proportional paid allocation', () => {
    // Proportional would be 300/200; the manual split forces 400/100.
    const split = splitPaymentsBySection(items, [{ paidAmount: 500 }], {
      paidSplitBySection: {
        [OrderSection.DIAGNOSTICS]: 400,
        [OrderSection.RADIOLOGY]: 100,
      },
    });
    expect(split[0]!.payments[0]!.paidAmount).toBe(400);
    expect(split[1]!.payments[0]!.paidAmount).toBe(100);
  });

  it('applies a manual paid split across multiple payment rows (sums per section)', () => {
    const split = splitPaymentsBySection(
      items,
      [{ paidAmount: 300 }, { paidAmount: 200 }], // total paid 500
      {
        paidSplitBySection: {
          [OrderSection.DIAGNOSTICS]: 400,
          [OrderSection.RADIOLOGY]: 100,
        },
      },
    );
    const diag = split[0]!.payments.reduce((s, p) => s + p.paidAmount, 0);
    const rad = split[1]!.payments.reduce((s, p) => s + p.paidAmount, 0);
    expect(diag).toBe(400);
    expect(rad).toBe(100);
  });

  it('keeps every non-paid field proportional under a manual paid split', () => {
    const split = splitPaymentsBySection(
      items,
      [{ netAmount: 1000, payableAmount: 1000, paidAmount: 500 }],
      {
        paidSplitBySection: {
          [OrderSection.DIAGNOSTICS]: 400,
          [OrderSection.RADIOLOGY]: 100,
        },
      },
    );
    // net/payable still split 60/40 by section weight; only paid is manual.
    expect(split[0]!.payments[0]!.netAmount).toBe(600);
    expect(split[1]!.payments[0]!.netAmount).toBe(400);
    expect(split[0]!.payments[0]!.payableAmount).toBe(600);
    expect(split[1]!.payments[0]!.payableAmount).toBe(400);
    expect(split[0]!.payments[0]!.paidAmount).toBe(400);
    expect(split[1]!.payments[0]!.paidAmount).toBe(100);
  });
});
