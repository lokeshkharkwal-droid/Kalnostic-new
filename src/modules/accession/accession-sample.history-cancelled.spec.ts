import { OrderStatus, SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import { OrderSampleNotFoundException } from './exceptions/accession.exceptions';

/**
 * The audit trail (Sample History) of a sample of a CANCELLED order shows an
 * "Order cancelled" line - who and when - read from the order itself: no history
 * row is written, and every other behaviour of the trail is unchanged.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 9, 14, 10, minute));

interface Row {
  id: string;
  action: string;
  fromStatus: SampleStatus | null;
  toStatus: SampleStatus;
  createdAt: Date;
  changedBy?: string | null;
}

const history = (over: Partial<Row> & Pick<Row, 'id' | 'action'>): Row => ({
  fromStatus: SampleStatus.COLLECTED,
  toStatus: SampleStatus.ACCEPTED,
  createdAt: at(0),
  changedBy: 'p1',
  ...over,
});

function build(opts: {
  rows?: Row[];
  order?: { id: string; updatedAt: Date; updatedBy: string | null } | null;
}) {
  const prisma = {
    orderSampleStatusHistory: {
      findMany: jest.fn().mockResolvedValue(opts.rows ?? []),
      create: jest.fn().mockResolvedValue({}),
    },
    order: {
      findFirst: jest.fn().mockResolvedValue(opts.order ?? null),
    },
  };
  const service = new OrderSampleService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const internals = service as unknown as {
    findById: jest.Mock;
    enrichHistoryActors: jest.Mock;
  };
  internals.findById = jest.fn().mockResolvedValue({
    id: 's1',
    orderId: 'o1',
    branchId: 'A',
    status: SampleStatus.ACCEPTED,
  });
  // pass the trail straight through so its content can be checked
  internals.enrichHistoryActors = jest
    .fn()
    .mockImplementation((trail: unknown[]) => Promise.resolve(trail));
  return { service, prisma, internals };
}

const cancelledOrder = { id: 'o1', updatedAt: at(30), updatedBy: 'canceller' };

describe('Sample History of a cancelled order', () => {
  it('adds an "Order cancelled" entry: who, when, in the shape of a history row', async () => {
    const m = build({
      rows: [history({ id: 'h1', action: 'accept' })],
      order: cancelledOrder,
    });
    const trail = (await m.service.findHistory(
      's1',
      't1',
      'A',
    )) as unknown as Row[];
    const entry = trail.find((r) => r.action === 'order-cancelled');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      id: 'order-cancelled:o1',
      sampleId: 's1',
      tenantId: 't1',
      branchId: 'A',
      action: 'order-cancelled',
      fromStatus: null,
      toStatus: SampleStatus.ACCEPTED,
      changedBy: 'canceller',
      createdAt: cancelledOrder.updatedAt,
    });
  });

  it('writes nothing: no history row is created', async () => {
    const m = build({ rows: [], order: cancelledOrder });
    await m.service.findHistory('s1', 't1', 'A');
    expect(m.prisma.orderSampleStatusHistory.create).not.toHaveBeenCalled();
  });

  it('sits at its place in the timeline, newest first', async () => {
    const m = build({
      rows: [
        history({ id: 'retrieve', action: 'retrieve', createdAt: at(50) }),
        history({ id: 'send', action: 'send', createdAt: at(10) }),
      ],
      order: cancelledOrder, // at(30)
    });
    const trail = (await m.service.findHistory(
      's1',
      't1',
      'A',
    )) as unknown as Row[];
    expect(trail.map((r) => r.action)).toEqual([
      'retrieve',
      'order-cancelled',
      'send',
    ]);
  });

  it('still shows when the sample has no other movement at all', async () => {
    const m = build({ rows: [], order: cancelledOrder });
    const trail = (await m.service.findHistory(
      's1',
      't1',
      'A',
    )) as unknown as Row[];
    expect(trail).toHaveLength(1);
    expect(trail[0]!.action).toBe('order-cancelled');
  });

  it('the non-movement rows stay out of the trail (only the cancel line is added)', async () => {
    const m = build({
      rows: [
        history({
          id: 'bc',
          action: 'assign-barcode',
          fromStatus: SampleStatus.ACCEPTED,
        }),
        history({
          id: 'gen',
          action: 'generate',
          fromStatus: null,
          toStatus: SampleStatus.NEW,
        }),
        history({ id: 'acc', action: 'accept' }),
      ],
      order: cancelledOrder,
    });
    const trail = (await m.service.findHistory(
      's1',
      't1',
      'A',
    )) as unknown as Row[];
    expect(trail.map((r) => r.id).sort()).toEqual([
      'acc',
      'order-cancelled:o1',
    ]);
  });

  it('an order with no recorded last user shows the line without a user (the screen says "System")', async () => {
    const m = build({
      rows: [],
      order: { id: 'o1', updatedAt: at(30), updatedBy: null },
    });
    const trail = (await m.service.findHistory(
      's1',
      't1',
      'A',
    )) as unknown as Row[];
    expect(trail[0]!.changedBy).toBeNull();
  });

  it('the actors are resolved for the cancel line too (it goes through the same enrichment)', async () => {
    const m = build({ rows: [], order: cancelledOrder });
    await m.service.findHistory('s1', 't1', 'A');
    const [trail, tenant, branch] = m.internals.enrichHistoryActors.mock
      .calls[0] as [Row[], string, string | null];
    expect(trail.map((r) => r.changedBy)).toContain('canceller');
    expect(tenant).toBe('t1');
    expect(branch).toBe('A');
  });
});

describe('Sample History of an order that is NOT cancelled is unchanged', () => {
  it('no extra line', async () => {
    const m = build({
      rows: [history({ id: 'h1', action: 'accept' })],
      order: null,
    });
    const trail = (await m.service.findHistory(
      's1',
      't1',
      'A',
    )) as unknown as Row[];
    expect(trail.map((r) => r.id)).toEqual(['h1']);
  });

  it("asks only about THIS sample's order, tenant-scoped, and only when it is cancelled and not deleted", async () => {
    const m = build({ rows: [], order: null });
    await m.service.findHistory('s1', 't1', 'A');
    expect(m.prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'o1',
          tenantId: 't1',
          status: OrderStatus.CANCELLED,
          deletedAt: null,
        },
      }),
    );
  });

  it('an empty trail stays empty', async () => {
    const m = build({ rows: [], order: null });
    await expect(m.service.findHistory('s1', 't1', 'A')).resolves.toEqual([]);
  });
});

describe('the branch limit on the history still comes first', () => {
  it('a branch with no stake gets "not found" and the order is never asked about', async () => {
    const m = build({ rows: [], order: cancelledOrder });
    m.internals.findById.mockRejectedValue(
      new OrderSampleNotFoundException('s1'),
    );
    await expect(m.service.findHistory('s1', 't1', 'X')).rejects.toBeInstanceOf(
      OrderSampleNotFoundException,
    );
    expect(m.prisma.order.findFirst).not.toHaveBeenCalled();
    expect(m.prisma.orderSampleStatusHistory.findMany).not.toHaveBeenCalled();
  });

  it("passes the caller's branch to the read, as before", async () => {
    const m = build({ rows: [], order: null });
    await m.service.findHistory('s1', 't1', 'B');
    expect(m.internals.findById).toHaveBeenCalledWith('s1', 't1', 'B');
  });
});

describe('Sample History of a copy created by an accepted transfer', () => {
  it('keeps the copy\'s single "transfer-accept" row (born Accepted, so no from-status) while other rows without a movement stay hidden', async () => {
    const m = build({
      rows: [
        history({
          id: 'barcode',
          action: 'assign-barcode',
          fromStatus: SampleStatus.ACCEPTED,
          toStatus: SampleStatus.ACCEPTED,
          createdAt: at(20),
        }),
        history({
          id: 'accepted',
          action: 'transfer-accept',
          fromStatus: null,
          toStatus: SampleStatus.ACCEPTED,
          createdAt: at(10),
        }),
        history({
          id: 'generated',
          action: 'generate',
          fromStatus: null,
          toStatus: SampleStatus.NEW,
          createdAt: at(0),
        }),
      ],
    });
    const trail = (await m.service.findHistory(
      's1',
      't1',
      'B',
    )) as unknown as Row[];
    expect(trail.map((r) => r.action)).toEqual(['transfer-accept']);
    expect(trail[0]).toMatchObject({
      fromStatus: null,
      toStatus: SampleStatus.ACCEPTED,
    });
  });
});
