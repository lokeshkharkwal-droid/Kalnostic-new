import { BillStatus, Prisma } from '@prisma/client';
import { OrderService } from './order.service';
import { ListOrdersDto } from './dto/list-orders.dto';

/**
 * Regression coverage for the Registration → Billings "Status" filter
 * (`GET /orders?billStatus=`). It matches the order's STORED `bill_status`
 * column — the single value the Billings list renders, kept current by
 * `recomputeBillStatusInTx` (so cancel/refund can't leave it reading `PAID` the
 * way the old `paymentStatus` filter did). `buildOrderWhere` therefore resolves
 * the filter to a direct Prisma `where.billStatus` equality (no in-memory ledger
 * scan), for every `BillStatus` including `CANCELLED`.
 */
describe('OrderService — billStatus list filter', () => {
  // `buildOrderWhere` doesn't scan for this filter anymore, but keep a findMany
  // stub so any unrelated candidate scan in the builder can't crash the test.
  const findMany = jest.fn<Promise<unknown[]>, [unknown]>();
  const deps = Array(13).fill(undefined) as unknown[];
  deps[0] = { order: { findMany } };
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  /** Run the private where-builder for a Billings-shaped query. */
  const build = async (billStatus: BillStatus) => {
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

  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
  });

  it.each<BillStatus>([
    BillStatus.PAID,
    BillStatus.NOT_PAID,
    BillStatus.PARTIALLY_PAID,
    BillStatus.CANCELLED,
    BillStatus.REQUIRE_REFUND,
    BillStatus.PARTIALLY_REFUNDED,
    BillStatus.FULLY_REFUNDED,
  ])('filters on the stored bill_status column for %s', async (billStatus) => {
    const where = await build(billStatus);
    expect(where.billStatus).toBe(billStatus);
  });

  it('adds no billStatus filter when the query omits it', async () => {
    const { where } = await (
      service as unknown as {
        buildOrderWhere: (
          q: ListOrdersDto,
          tenantId: string,
          branchId: string | null,
        ) => Promise<{ where: Prisma.OrderWhereInput }>;
      }
    ).buildOrderWhere({ section: 'DIAGNOSTICS' }, 'tenant-1', 'branch-1');
    expect(where.billStatus).toBeUndefined();
  });
});
