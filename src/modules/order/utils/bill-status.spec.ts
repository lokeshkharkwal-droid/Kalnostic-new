import { BillStatus, DiscountMode, OrderStatus, Prisma } from '@prisma/client';
import {
  billStatusLabel,
  deriveBillStatus,
  recomputeBillStatusInTx,
} from './bill-status';

describe('billStatusLabel', () => {
  it('reads Cancelled for a cancelled order regardless of money', () => {
    // A cancelled order that was part-paid (stored paymentStatus PARTIALLY_PAID).
    expect(billStatusLabel(OrderStatus.CANCELLED, 1000, 1000, 0)).toBe(
      'Cancelled',
    );
    // A cancelled order that was fully refunded (stored NOT_PAID/FULLY_REFUNDED).
    expect(billStatusLabel(OrderStatus.CANCELLED, 2100, 0, 2100)).toBe(
      'Cancelled',
    );
  });

  it('reads Not Paid when nothing has been collected', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 1000, 0, 0)).toBe('Not Paid');
  });

  it('reads Partially Paid when some but not all of the net is collected', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 1000, 400, 0)).toBe(
      'Partially Paid',
    );
  });

  it('reads Paid when the net is fully collected', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 1000, 1000, 0)).toBe('Paid');
  });

  it('reads Paid when nothing is owed (Generate Bill = No / 100% discount)', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 0, 0, 0)).toBe('Paid');
  });

  it('reads Require Refund when overpaid and nothing refunded yet', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 800, 1000, 0)).toBe(
      'Require Refund',
    );
  });

  it('reads Partially Refunded when overpaid and part of the refund is paid', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 800, 900, 100)).toBe(
      'Partially Refunded',
    );
  });

  it('reads Fully Refunded when a refund settled the order exactly at its net', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 800, 800, 200)).toBe(
      'Fully Refunded',
    );
  });

  it('ignores sub-paisa float noise when checking settlement', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 0.1 + 0.2, 0.3, 0)).toBe('Paid');
  });
});

describe('deriveBillStatus', () => {
  it('returns exactly one status — CANCELLED wins over any payment/refund state', () => {
    // Paid in full, then cancelled with no refund (stored paymentStatus stays PAID).
    expect(deriveBillStatus(OrderStatus.CANCELLED, 1000, 1000, 0)).toBe(
      BillStatus.CANCELLED,
    );
    // Overpaid, partially refunded, then cancelled.
    expect(deriveBillStatus(OrderStatus.CANCELLED, 600, 850, 150)).toBe(
      BillStatus.CANCELLED,
    );
  });

  it('labels each enum value exactly as the Billings list does', () => {
    expect(billStatusLabel(OrderStatus.ORDER, 600, 850, 150)).toBe(
      'Partially Refunded',
    );
    expect(deriveBillStatus(OrderStatus.ORDER, 600, 850, 150)).toBe(
      BillStatus.PARTIALLY_REFUNDED,
    );
  });
});

/** Minimal tx double: one order with its active payment + item rows. */
function fakeTx(order: {
  status: OrderStatus;
  cancellationCharge?: number;
  payments: Array<{
    netAmount?: number;
    paidAmount?: number;
    refundAmount?: number;
    refundCharge?: number;
    totalAmount?: number;
    orderDiscount?: number;
    orderDiscountMode?: DiscountMode | null;
    orderDiscountValue?: number | null;
  }>;
  items: Array<{ unitPrice: number; discount?: number }>;
}) {
  const d = (n?: number) => new Prisma.Decimal(n ?? 0);
  const row = {
    status: order.status,
    cancellationCharge: d(order.cancellationCharge),
    payments: order.payments.map((p) => ({
      totalAmount: d(p.totalAmount),
      orderDiscount: d(p.orderDiscount),
      netAmount: d(p.netAmount),
      orderDiscountMode: p.orderDiscountMode ?? null,
      orderDiscountValue: p.orderDiscountValue ?? null,
      paidAmount: d(p.paidAmount),
      refundAmount: d(p.refundAmount),
      refundCharge: d(p.refundCharge),
    })),
    items: order.items.map((i) => ({
      unitPrice: i.unitPrice,
      discount: d(i.discount),
    })),
  };
  const update = jest.fn().mockResolvedValue({});
  const tx = {
    order: { findFirst: jest.fn().mockResolvedValue(row), update },
  } as unknown as Prisma.TransactionClient;
  return { tx, update };
}

describe('recomputeBillStatusInTx', () => {
  const run = async (order: Parameters<typeof fakeTx>[0]) => {
    const { tx, update } = fakeTx(order);
    const result = await recomputeBillStatusInTx(tx, 't1', 'o1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { billStatus: result },
    });
    return result;
  };

  it('normal payment: Not Paid → Partially Paid → Paid', async () => {
    const items = [{ unitPrice: 1000 }];
    expect(
      await run({
        status: OrderStatus.ORDER,
        items,
        payments: [{ netAmount: 1000 }],
      }),
    ).toBe(BillStatus.NOT_PAID);
    expect(
      await run({
        status: OrderStatus.ORDER,
        items,
        payments: [{ netAmount: 1000, paidAmount: 400 }],
      }),
    ).toBe(BillStatus.PARTIALLY_PAID);
    expect(
      await run({
        status: OrderStatus.ORDER,
        items,
        payments: [{ netAmount: 1000, paidAmount: 400 }, { paidAmount: 600 }],
      }),
    ).toBe(BillStatus.PAID);
  });

  it('cancellation after full payment, no refund → CANCELLED (never PAID)', async () => {
    expect(
      await run({
        status: OrderStatus.CANCELLED,
        items: [{ unitPrice: 1000 }],
        payments: [{ netAmount: 1000, paidAmount: 1000 }],
      }),
    ).toBe(BillStatus.CANCELLED);
  });

  it('cancellation with full refund → CANCELLED', async () => {
    expect(
      await run({
        status: OrderStatus.CANCELLED,
        items: [{ unitPrice: 1000 }],
        payments: [
          { netAmount: 1000, paidAmount: 1000 },
          { refundAmount: 1000 },
        ],
      }),
    ).toBe(BillStatus.CANCELLED);
  });

  it('partial refund of a surplus (test removed): Require → Partially → Fully Refunded', async () => {
    // Paid 1000; a 400 test removed → items/net 600, surplus 400.
    const base = {
      status: OrderStatus.ORDER,
      items: [{ unitPrice: 600 }],
    };
    expect(
      await run({ ...base, payments: [{ netAmount: 600, paidAmount: 1000 }] }),
    ).toBe(BillStatus.REQUIRE_REFUND);
    expect(
      await run({
        ...base,
        payments: [{ netAmount: 600, paidAmount: 1000 }, { refundAmount: 150 }],
      }),
    ).toBe(BillStatus.PARTIALLY_REFUNDED);
    expect(
      await run({
        ...base,
        payments: [
          { netAmount: 600, paidAmount: 1000 },
          { refundAmount: 150 },
          { refundAmount: 250 },
        ],
      }),
    ).toBe(BillStatus.FULLY_REFUNDED);
  });

  it('partial refund then cancel → CANCELLED only', async () => {
    expect(
      await run({
        status: OrderStatus.CANCELLED,
        items: [{ unitPrice: 600 }],
        payments: [{ netAmount: 600, paidAmount: 1000 }, { refundAmount: 150 }],
      }),
    ).toBe(BillStatus.CANCELLED);
  });

  it('mixed: refund charge + re-payment settles to Paid only when the net is covered', async () => {
    // Paid 1000, net 600, refunded 300 with a 100 refund charge → retained 600.
    expect(
      await run({
        status: OrderStatus.ORDER,
        items: [{ unitPrice: 600 }],
        payments: [
          { netAmount: 600, paidAmount: 1000 },
          { refundAmount: 300, refundCharge: 100 },
        ],
      }),
    ).toBe(BillStatus.FULLY_REFUNDED);
    // A test is added back (net 900) and the extra 300 collected.
    expect(
      await run({
        status: OrderStatus.ORDER,
        items: [{ unitPrice: 600 }, { unitPrice: 300 }],
        payments: [
          { netAmount: 900, paidAmount: 1000 },
          { refundAmount: 300, refundCharge: 100 },
          { paidAmount: 300 },
        ],
      }),
    ).toBe(BillStatus.FULLY_REFUNDED);
    expect(
      await run({
        status: OrderStatus.ORDER,
        items: [{ unitPrice: 600 }, { unitPrice: 300 }],
        payments: [{ netAmount: 900, paidAmount: 500 }],
      }),
    ).toBe(BillStatus.PARTIALLY_PAID);
  });

  it('uses the item-based net (PERCENT order discount re-applied) like the list row', async () => {
    // 10% order discount frozen as 100 (of 1000); a 500 test was then removed and
    // the ledger rewritten with the stale discount (net 400). The authoritative
    // net re-applies 10% to the current 500 ⇒ 450. Paid 450 ⇒ Paid (the stale
    // ledger net would read Require Refund).
    expect(
      await run({
        status: OrderStatus.ORDER,
        items: [{ unitPrice: 500 }],
        payments: [
          {
            totalAmount: 500,
            orderDiscount: 100,
            netAmount: 400,
            orderDiscountMode: DiscountMode.PERCENT,
            orderDiscountValue: 10,
            paidAmount: 450,
          },
        ],
      }),
    ).toBe(BillStatus.PAID);
  });

  it('nothing owed (Generate Bill = No) → PAID', async () => {
    expect(
      await run({
        status: OrderStatus.ORDER,
        items: [{ unitPrice: 1000 }],
        payments: [{ totalAmount: 1000 }],
      }),
    ).toBe(BillStatus.PAID);
  });
});
