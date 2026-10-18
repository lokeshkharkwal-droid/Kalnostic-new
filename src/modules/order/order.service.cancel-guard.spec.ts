import { LabReportStatus, OrderStatus } from '@prisma/client';
import { OrderService } from './order.service';
import { CANCEL_BLOCKING_REPORT_STATUSES } from './utils/cancel-rules.util';
import { OrderCancelBlockedByResultException } from './exceptions/order.exceptions';

/**
 * The lab's say in cancelling an order: refuse when any report is CURRENTLY
 * Result Done / Approved / Published (one among many is enough, at any branch).
 * Everything earlier - and the Error Reported / Result Rejected states - still
 * allows the cancel, and so does a sample that is out at another branch.
 */
/** The `where` of the first call to a mocked Prisma finder. */
const firstWhere = (m: jest.Mock): Record<string, unknown> =>
  (m.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;

describe('OrderService - cancel guard (lab rules)', () => {
  const calls: string[] = [];
  const tx = {
    $queryRaw: jest.fn(),
    labReport: { findFirst: jest.fn() },
    orderSample: { findFirst: jest.fn() },
  };

  const deps = Array(14).fill(undefined) as unknown[];
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );
  const guard = (orderId = 'o1') =>
    (
      service as unknown as {
        assertLabAllowsCancel: (
          t: typeof tx,
          tenantId: string,
          orderId: string,
        ) => Promise<void>;
      }
    ).assertLabAllowsCancel(tx, 't1', orderId);

  beforeEach(() => {
    calls.length = 0;
    tx.$queryRaw.mockReset().mockImplementation(() => {
      calls.push('lock');
      return Promise.resolve([]);
    });
    tx.labReport.findFirst.mockReset().mockImplementation(() => {
      calls.push('reports');
      return Promise.resolve(null);
    });
    tx.orderSample.findFirst.mockReset().mockImplementation(() => {
      calls.push('samples');
      return Promise.resolve({ id: 's-out' });
    });
  });

  it('allows the cancel when nothing is validated', async () => {
    await expect(guard()).resolves.toBeUndefined();
  });

  it("locks the order's reports BEFORE looking at their status", async () => {
    await guard();
    expect(calls.slice(0, 2)).toEqual(['lock', 'reports']);
  });

  it('refuses when a report is Result Done, Approved or Published', async () => {
    tx.labReport.findFirst.mockResolvedValue({ id: 'r1' });
    await expect(guard()).rejects.toBeInstanceOf(
      OrderCancelBlockedByResultException,
    );
    const where = firstWhere(tx.labReport.findFirst);
    expect((where.status as { in: unknown }).in).toEqual([
      LabReportStatus.RESULT_DONE,
      LabReportStatus.APPROVED,
      LabReportStatus.PUBLISHED,
    ]);
    // only the order's own live reports, whichever branch holds them
    expect(where.orderItem).toEqual({ orderId: 'o1' });
    expect(where.deletedAt).toBeNull();
    expect(where.branchId).toBeUndefined();
  });

  it('reports the 409 code the screen can recognise', async () => {
    tx.labReport.findFirst.mockResolvedValue({ id: 'r1' });
    await expect(guard()).rejects.toMatchObject({
      response: { error: { code: 'ORDER_CANCEL_BLOCKED_RESULT_DONE' } },
    });
  });

  it.each([
    LabReportStatus.PENDING,
    LabReportStatus.PARTIAL_PENDING,
    LabReportStatus.SAVED,
    LabReportStatus.VALIDATION_PENDING,
    LabReportStatus.ERROR_REPORTED,
    LabReportStatus.RESULT_REJECTED,
  ])('%s does not block a cancel', (status) => {
    expect(CANCEL_BLOCKING_REPORT_STATUSES).not.toContain(status);
  });

  it('a sample that is out at another branch does NOT block the cancel', async () => {
    // the mock would report a sent sample if it were ever asked
    await expect(guard()).resolves.toBeUndefined();
    expect(tx.orderSample.findFirst).not.toHaveBeenCalled();
  });
});

describe('OrderService.cancel - the lab rule runs before anything changes', () => {
  it('writes nothing when the lab refuses', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { update: jest.fn() },
      paymentDetails: { aggregate: jest.fn() },
    };
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({}) },
      withTenant: jest.fn((_t: string, cb: (x: typeof tx) => unknown) =>
        cb(tx),
      ),
    };
    const settings = {
      getForBranch: jest.fn().mockResolvedValue(null),
    };
    const deps = Array(14).fill(undefined) as unknown[];
    deps[0] = prisma;
    deps[7] = settings;
    const service = new OrderService(
      ...(deps as ConstructorParameters<typeof OrderService>),
    );
    const internals = service as unknown as Record<string, unknown>;
    internals.findById = jest.fn().mockResolvedValue({
      id: 'o1',
      status: OrderStatus.ORDER,
      branchId: null,
    });
    internals.assertNotInvoiced = jest.fn().mockResolvedValue(undefined);
    internals.assertLabAllowsCancel = jest
      .fn()
      .mockRejectedValue(new OrderCancelBlockedByResultException('o1'));

    await expect(service.cancel('o1', 't1', 'u1', {})).rejects.toBeInstanceOf(
      OrderCancelBlockedByResultException,
    );
    expect(tx.paymentDetails.aggregate).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('takes the order row FOR UPDATE before the lab check (cancel vs accept race)', async () => {
    const order: string[] = [];
    const tx = {
      $queryRaw: jest.fn((...a: unknown[]) => {
        order.push('lock');
        const sql = (a[0] as string[]).join('?');
        expect(sql).toContain('FROM orders');
        expect(sql).toContain('FOR UPDATE');
        return Promise.resolve([]);
      }),
      order: { update: jest.fn() },
      paymentDetails: { aggregate: jest.fn() },
    };
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({}) },
      withTenant: jest.fn((_t: string, cb: (x: typeof tx) => unknown) =>
        cb(tx),
      ),
    };
    const deps = Array(14).fill(undefined) as unknown[];
    deps[0] = prisma;
    deps[7] = { getForBranch: jest.fn().mockResolvedValue(null) };
    const service = new OrderService(
      ...(deps as ConstructorParameters<typeof OrderService>),
    );
    const internals = service as unknown as Record<string, unknown>;
    internals.findById = jest.fn().mockResolvedValue({
      id: 'o1',
      status: OrderStatus.ORDER,
      branchId: null,
    });
    internals.assertNotInvoiced = jest.fn().mockResolvedValue(undefined);
    internals.assertLabAllowsCancel = jest.fn().mockImplementation(() => {
      order.push('lab-check');
      return Promise.reject(new OrderCancelBlockedByResultException('o1'));
    });
    await expect(service.cancel('o1', 't1', 'u1', {})).rejects.toBeInstanceOf(
      OrderCancelBlockedByResultException,
    );
    expect(order).toEqual(['lock', 'lab-check']);
  });
});

describe('OrderService - cancelBlockedReasons (Billings flag)', () => {
  const prisma = {
    labReport: { findMany: jest.fn() },
    orderSample: { findMany: jest.fn() },
  };
  const deps = Array(14).fill(undefined) as unknown[];
  deps[0] = prisma;
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );
  const reasons = (ids: string[]) =>
    (
      service as unknown as {
        cancelBlockedReasons: (
          t: string,
          ids: string[],
        ) => Promise<Map<string, string>>;
      }
    ).cancelBlockedReasons('t1', ids);

  beforeEach(() => {
    prisma.labReport.findMany.mockReset().mockResolvedValue([]);
    prisma.orderSample.findMany.mockReset().mockResolvedValue([]);
  });

  it('is empty (and queries nothing) for no orders', async () => {
    expect((await reasons([])).size).toBe(0);
    expect(prisma.labReport.findMany).not.toHaveBeenCalled();
  });

  it('flags only the orders with a validated result', async () => {
    prisma.labReport.findMany.mockResolvedValue([
      { orderItem: { orderId: 'o1' } },
    ]);
    const m = await reasons(['o1', 'o2']);
    expect(m.get('o1')).toBe('RESULT_DONE');
    expect(m.has('o2')).toBe(false);
  });

  it('a sample at another branch is not a reason (nothing is read about samples)', async () => {
    prisma.orderSample.findMany.mockResolvedValue([{ orderId: 'o2' }]);
    const m = await reasons(['o2']);
    expect(m.has('o2')).toBe(false);
    expect(prisma.orderSample.findMany).not.toHaveBeenCalled();
  });

  it('uses the same blocking statuses as the cancel itself', async () => {
    await reasons(['o1']);
    expect(
      (firstWhere(prisma.labReport.findMany).status as { in: unknown }).in,
    ).toEqual(CANCEL_BLOCKING_REPORT_STATUSES);
  });
});
