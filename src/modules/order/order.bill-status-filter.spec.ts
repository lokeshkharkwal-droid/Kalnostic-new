import { OrderStatus, Prisma } from '@prisma/client';
import { OrderService } from './order.service';
import { ListOrdersDto } from './dto/list-orders.dto';
import { BillStatusFilter } from './utils/bill-status';

/**
 * Regression coverage for the Registration → Billings "Status" filter
 * (`GET /orders?billStatus=`). It must match the label the Status column shows
 * (`billStatusLabel`), never the stored `paymentStatus` — that stays PAID after
 * a cancel or a surplus refund, so "Paid" used to list Cancelled and Fully
 * Refunded bills.
 *
 * `buildOrderWhere` only touches `prisma.order.findMany` for this filter, so
 * that is stubbed with one candidate per ledger state and the private builder
 * is exercised directly.
 */
describe('OrderService — billStatus list filter', () => {
  /** A legacy (no discount mode) ledger row: `net` on the opening row only. */
  const ledgerRow = (
    paid: number,
    opts: { net?: number; refund?: number; refundCharge?: number } = {},
  ) => ({
    totalAmount: opts.net ?? 0,
    orderDiscount: 0,
    orderDiscountMode: null,
    orderDiscountValue: null,
    netAmount: opts.net ?? 0,
    paidAmount: paid,
    refundAmount: opts.refund ?? 0,
    refundCharge: opts.refundCharge ?? 0,
  });

  /** A non-cancelled candidate as the scan selects it. */
  const candidate = (
    id: string,
    payments: ReturnType<typeof ledgerRow>[],
    cancellationCharge = 0,
  ) => ({
    id,
    status: OrderStatus.ORDER,
    cancellationCharge,
    items: [
      { unitPrice: 600, discount: 0 },
      { unitPrice: 400, discount: 0 },
    ],
    payments,
  });

  // One order per non-cancelled label. The refund cases had a 400 test removed
  // after paying 1000 in full, so the net dropped to 600 (their stored
  // `paymentStatus` is PAID — exactly what the old filter matched on).
  const CANDIDATES = [
    candidate('paid', [ledgerRow(1000, { net: 1000 })]),
    candidate('not-paid', [ledgerRow(0, { net: 1000 })]),
    candidate('partially-paid', [ledgerRow(400, { net: 1000 })]),
    candidate('require-refund', [ledgerRow(1000, { net: 600 })]),
    candidate('partially-refunded', [
      ledgerRow(1000, { net: 600 }),
      ledgerRow(0, { refund: 100 }),
    ]),
    candidate('fully-refunded', [
      ledgerRow(1000, { net: 600 }),
      ledgerRow(0, { refund: 400 }),
    ]),
  ];

  const findMany = jest.fn<
    Promise<unknown[]>,
    [{ where: Prisma.OrderWhereInput }]
  >();
  const deps = Array(13).fill(undefined) as unknown[];
  deps[0] = { order: { findMany } };
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  /** Run the private where-builder for a Billings-shaped query. */
  const build = async (billStatus: BillStatusFilter) => {
    const { where } = await (
      service as unknown as {
        buildOrderWhere: (
          q: ListOrdersDto,
          tenantId: string,
          branchId: string | null,
        ) => Promise<{ where: Prisma.OrderWhereInput }>;
      }
    ).buildOrderWhere(
      { section: 'DIAGNOSTICS', billStatus },
      'tenant-1',
      'branch-1',
    );
    return where;
  };

  /** The ids the `id: { in }` clause keeps, or undefined when none was added. */
  const matchedIds = (where: Prisma.OrderWhereInput) => {
    const clauses = (where.AND ?? []) as Prisma.OrderWhereInput[];
    const idClause = clauses.find((c) => c.id !== undefined);
    return (idClause?.id as { in: string[] } | undefined)?.in;
  };

  beforeEach(() => {
    findMany.mockReset().mockResolvedValue(CANDIDATES);
  });

  it.each<[BillStatusFilter, string]>([
    ['PAID', 'paid'],
    ['NOT_PAID', 'not-paid'],
    ['PARTIALLY_PAID', 'partially-paid'],
    ['REQUIRE_REFUND', 'require-refund'],
    ['PARTIALLY_REFUNDED', 'partially-refunded'],
    ['FULLY_REFUNDED', 'fully-refunded'],
  ])('%s keeps only the %s order', async (billStatus, id) => {
    expect(matchedIds(await build(billStatus))).toEqual([id]);
  });

  it('PAID excludes cancelled orders from the scan and refunded ones from the match', async () => {
    const ids = matchedIds(await build('PAID'));
    expect(ids).not.toContain('fully-refunded');
    expect(ids).not.toContain('partially-refunded');

    // Cancelled orders never reach the money check (stored PAID or not).
    const scanWhere = findMany.mock.calls[0]?.[0].where;
    expect(scanWhere?.AND).toContainEqual({
      status: { not: OrderStatus.CANCELLED },
    });
    // The scan runs inside the screen's own scope (tenant/branch/section).
    expect(scanWhere).toMatchObject({
      tenantId: 'tenant-1',
      branchId: 'branch-1',
      diagnostics: { is: {} },
    });
  });

  it('nets the cancellation charge out of the paid amount', async () => {
    // Paid 1000 in full but 200 was retained as a charge → 800 effective.
    findMany.mockResolvedValue([
      candidate('charged', [ledgerRow(1000, { net: 1000 })], 200),
    ]);
    expect(matchedIds(await build('PARTIALLY_PAID'))).toEqual(['charged']);
  });

  it('CANCELLED filters on the order status without scanning', async () => {
    const where = await build('CANCELLED');
    expect(findMany).not.toHaveBeenCalled();
    expect(where.AND).toContainEqual({ status: OrderStatus.CANCELLED });
    expect(matchedIds(where)).toBeUndefined();
  });
});
