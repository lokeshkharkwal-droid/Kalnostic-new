import {
  OrderStatus,
  PaymentEntryType,
  PaymentMode,
  PaymentStatus,
} from '@prisma/client';
import { OrderService } from './order.service';

/**
 * Regression coverage for the bill's `{bill_status}` / `{payment_status}` tags.
 * Both must read the order's LIVE state (lifecycle status + payment ledger),
 * never the stored `paymentStatus` enum — `cancel`/`refund` recompute that as a
 * pure payment state, so a cancelled or surplus-refunded order kept printing
 * the pre-action value (`PAID` / `PARTIALLY_PAID`, underscores included).
 *
 * The bill builders only touch `prisma.person` (collector name) and
 * `tenantService.getLocale`, so those two are stubbed and the private
 * per-type dispatcher is exercised directly.
 */
describe('OrderService — bill status print tags', () => {
  const prisma = { person: { findMany: jest.fn().mockResolvedValue([]) } };
  const tenantService = {
    getLocale: jest.fn().mockResolvedValue({
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
    }),
  };
  const deps = Array(13).fill(undefined) as unknown[];
  deps[0] = prisma;
  deps[11] = tenantService;
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  /** A PAYMENT ledger row collecting `paid`; order-level totals only on the opening row. */
  const paymentRow = (paid: number, totals?: { net: number }) => ({
    entryType: PaymentEntryType.PAYMENT,
    totalAmount: totals?.net ?? 0,
    orderDiscount: 0,
    netAmount: totals?.net ?? 0,
    paidAmount: paid,
    refundAmount: 0,
    refundCharge: 0,
    paymentMode: PaymentMode.CASH,
    paymentDate: new Date('2026-09-24T00:00:00.000Z'),
    reference: null,
    collectedBy: null,
  });

  /** A REFUND ledger row returning `amount` to the patient. */
  const refundRow = (amount: number) => ({
    ...paymentRow(0),
    entryType: PaymentEntryType.REFUND,
    refundAmount: amount,
  });

  /**
   * A 2-test order netting 1000, built so its STORED `paymentStatus` can be set
   * independently of its ledger (to prove the tags ignore that column).
   */
  const order = (overrides: {
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    net?: number;
    cancellationCharge?: number;
    payments: Array<Record<string, unknown>>;
  }) => {
    const payments = overrides.payments;
    return {
      id: 'order-1',
      orderCode: 'ORD-1',
      billId: 'DIG-001',
      status: overrides.status ?? OrderStatus.ORDER,
      paymentStatus: overrides.paymentStatus ?? PaymentStatus.NOT_PAID,
      orderDate: new Date('2026-09-24T00:00:00.000Z'),
      orderTime: null,
      createdAt: new Date('2026-09-24T06:00:00.000Z'),
      createdBy: null,
      items: [
        { unitPrice: 600, discount: 0, direct: 'Test A' },
        { unitPrice: 400, discount: 0, direct: 'Test B' },
      ],
      payments,
      diagnostics: null,
      discountAmount: 0,
      netAmount: overrides.net ?? 1000,
      paidAmount: payments.reduce((s, p) => s + Number(p.paidAmount), 0),
      cancellationCharge: overrides.cancellationCharge ?? 0,
      branch: { name: 'Main Branch' },
      referredByDoctor: null,
      referralPanel: null,
      patient: {
        firstName: 'Asha',
        middleName: null,
        lastName: 'Verma',
        salutation: null,
        dateOfBirth: null,
        age: null,
        ageType: null,
        gender: null,
        umId: 'UM-1',
        mobile: '9000000000',
        email: null,
        bloodGroup: null,
        addressLine1: null,
      },
    };
  };

  /** Render `type`'s variables for the order and return both status tags. */
  const statusTags = async (
    o: ReturnType<typeof order>,
    type = 'bill_print',
  ) => {
    const { variables = {} } = await (
      service as unknown as {
        buildPrintContext: (
          o: unknown,
          t: string,
          tenantId: string,
        ) => Promise<{ variables?: Record<string, unknown> }>;
      }
    ).buildPrintContext(o, type, 'tenant-1');
    const billStatus = variables.bill_status;
    const paymentStatus = variables.payment_status;
    // The two tags are one value under two names, and never a raw enum.
    expect(paymentStatus).toBe(billStatus);
    expect(String(billStatus)).not.toContain('_');
    return billStatus;
  };

  it('reads the payment states with spaced labels', async () => {
    expect(
      await statusTags(order({ payments: [paymentRow(0, { net: 1000 })] })),
    ).toBe('Not Paid');
    expect(
      await statusTags(
        order({
          paymentStatus: PaymentStatus.PARTIALLY_PAID,
          payments: [paymentRow(400, { net: 1000 })],
        }),
      ),
    ).toBe('Partially Paid');
    expect(
      await statusTags(
        order({
          paymentStatus: PaymentStatus.PAID,
          payments: [paymentRow(400, { net: 1000 }), paymentRow(600)],
        }),
      ),
    ).toBe('Paid');
  });

  it('reads Cancelled after an order cancel even though the stored paymentStatus is still PAID', async () => {
    expect(
      await statusTags(
        order({
          status: OrderStatus.CANCELLED,
          paymentStatus: PaymentStatus.PAID,
          payments: [paymentRow(1000, { net: 1000 })],
        }),
      ),
    ).toBe('Cancelled');
  });

  it('reads Cancelled after a cancel with a cancellation charge (stored PARTIALLY_PAID)', async () => {
    expect(
      await statusTags(
        order({
          status: OrderStatus.CANCELLED,
          paymentStatus: PaymentStatus.PARTIALLY_PAID,
          cancellationCharge: 100,
          payments: [paymentRow(1000, { net: 1000 })],
        }),
      ),
    ).toBe('Cancelled');
  });

  it('reads Cancelled after a cancel with a refund leg', async () => {
    expect(
      await statusTags(
        order({
          status: OrderStatus.CANCELLED,
          paymentStatus: PaymentStatus.NOT_PAID,
          payments: [paymentRow(1000, { net: 1000 }), refundRow(1000)],
        }),
      ),
    ).toBe('Cancelled');
  });

  it('tracks a surplus refund through Require → Partially → Fully Refunded while the stored paymentStatus stays PAID', async () => {
    // A test was removed after full payment: net drops 1000 → 600, paid 1000.
    const surplus = (refunds: number[]) =>
      order({
        paymentStatus: PaymentStatus.PAID,
        net: 600,
        payments: [
          paymentRow(1000, { net: 600 }),
          ...refunds.map((r) => refundRow(r)),
        ],
      });
    expect(await statusTags(surplus([]))).toBe('Require Refund');
    expect(await statusTags(surplus([150]))).toBe('Partially Refunded');
    expect(await statusTags(surplus([150, 250]))).toBe('Fully Refunded');
  });

  it('gives accounts_biling the same status as the patient bill', async () => {
    const cancelled = order({
      status: OrderStatus.CANCELLED,
      paymentStatus: PaymentStatus.PAID,
      payments: [paymentRow(1000, { net: 1000 })],
    });
    expect(await statusTags(cancelled, 'accounts_biling')).toBe('Cancelled');
  });
});
