import 'reflect-metadata';
import { BillStatus, OrderStatus, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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

  // ── Additional coverage (added alongside the two tests above) ──────────────

  /** Run the private where-builder for any query. */
  const buildQuery = async (query: ListOrdersDto) => {
    const { where } = await (
      service as unknown as {
        buildOrderWhere: (
          q: ListOrdersDto,
          tenantId: string,
          branchId: string | null,
        ) => Promise<{ where: Prisma.OrderWhereInput }>;
      }
    ).buildOrderWhere(query, 'tenant-1', 'branch-1');
    return where;
  };

  it('offers exactly the seven statuses the Billings screen shows', () => {
    expect([...Object.values(BillStatus)].sort()).toEqual([
      'CANCELLED',
      'FULLY_REFUNDED',
      'NOT_PAID',
      'PAID',
      'PARTIALLY_PAID',
      'PARTIALLY_REFUNDED',
      'REQUIRE_REFUND',
    ]);
  });

  it('answers from the indexed column alone: no orders are loaded to scan', async () => {
    await buildQuery({
      section: 'DIAGNOSTICS',
      billStatus: BillStatus.NOT_PAID,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('composes with the Billings drafts/quotations exclusion instead of replacing it', async () => {
    const where = await buildQuery({
      section: 'DIAGNOSTICS',
      hideUnpaidAppointments: true,
      billStatus: BillStatus.PAID,
    });
    expect(where.billStatus).toBe(BillStatus.PAID);
    expect(where.AND).toContainEqual({
      status: { notIn: [OrderStatus.DRAFT, OrderStatus.QUOTE] },
    });
  });

  it('composes with the other screen filters', async () => {
    const where = await buildQuery({
      section: 'DIAGNOSTICS',
      billStatus: BillStatus.PARTIALLY_PAID,
      referralPanelId: 'panel-1',
    });
    expect(where).toMatchObject({
      billStatus: BillStatus.PARTIALLY_PAID,
      referralPanelId: 'panel-1',
      tenantId: 'tenant-1',
      branchId: 'branch-1',
    });
  });

  describe('the query parameter', () => {
    const check = (value: unknown) =>
      validate(plainToInstance(ListOrdersDto, { billStatus: value }));

    it.each(Object.values(BillStatus))('accepts %s', async (v) => {
      expect(await check(v)).toHaveLength(0);
    });

    it.each(['paid', 'Paid', 'BANANA', 'FULLY REFUNDED', ''])(
      'rejects %j',
      async (v) => {
        const errors = await check(v);
        expect(errors.some((e) => e.property === 'billStatus')).toBe(true);
      },
    );

    it('is declared once on the DTO (a second declaration breaks the build)', () => {
      const instance = plainToInstance(ListOrdersDto, {
        billStatus: 'NOT_PAID',
      });
      expect(instance.billStatus).toBe('NOT_PAID');
    });
  });
});
