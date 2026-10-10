import { LabReportService } from './lab-report.service';
import {
  sortWorklistMatches,
  type WorklistMatch,
} from './utils/worklist-order.util';

const at = (s: string) => new Date(s);

/** A report that matched the filters. */
const match = (
  id: string,
  orderId: string,
  orderCreatedAt: string,
  createdAt = '2026-10-09T15:00:00.000Z',
): WorklistMatch => ({
  id,
  orderId,
  orderCreatedAt: at(orderCreatedAt),
  createdAt: at(createdAt),
});

const ids = (rows: WorklistMatch[]) => rows.map((r) => r.id);

/**
 * Technician → Reporting worklist order. Newest first by when the order's newest
 * live sample was created (when the order actually entered accession), the same
 * way the Accession worklist orders its orders — not by `Order.createdAt`, which
 * a Draft/Appointment keeps from the day it was first saved even if it is
 * converted into an order much later.
 */
describe('sortWorklistMatches', () => {
  it('a Draft converted today ranks above an order placed earlier today, despite its old order date', () => {
    const matches = [
      // placed 8 Oct, sample generated at 20:10 today
      match('placed-today', 'o-today', '2026-10-09T14:40:00.000Z'),
      // saved as a Draft on 28 Sep, converted (samples generated) at 20:30 today
      match('old-draft', 'o-draft', '2026-09-28T08:51:00.000Z'),
    ];
    const latest = new Map([
      ['o-today', at('2026-10-09T14:40:05.000Z')],
      ['o-draft', at('2026-10-09T15:00:00.000Z')],
    ]);
    expect(ids(sortWorklistMatches(matches, latest))).toEqual([
      'old-draft',
      'placed-today',
    ]);
  });

  it('plain orders (sample created with the order) keep newest-order-first', () => {
    const matches = [
      match('a', 'o1', '2026-10-09T14:40:00.000Z'),
      match('b', 'o2', '2026-10-09T14:41:10.000Z'),
      match('c', 'o3', '2026-10-09T14:40:33.000Z'),
    ];
    const latest = new Map([
      ['o1', at('2026-10-09T14:40:00.500Z')],
      ['o2', at('2026-10-09T14:41:10.500Z')],
      ['o3', at('2026-10-09T14:40:33.500Z')],
    ]);
    expect(ids(sortWorklistMatches(matches, latest))).toEqual(['b', 'c', 'a']);
  });

  it('uses the NEWEST sample of an order when it has several', () => {
    const matches = [
      match('x', 'o-multi', '2026-10-01T10:00:00.000Z'),
      match('y', 'o-single', '2026-10-05T10:00:00.000Z'),
    ];
    // o-multi got an extra sample added later (order edited) — that is its key
    const latest = new Map([
      ['o-multi', at('2026-10-09T09:00:00.000Z')],
      ['o-single', at('2026-10-05T10:00:01.000Z')],
    ]);
    expect(ids(sortWorklistMatches(matches, latest))).toEqual(['x', 'y']);
  });

  it('an order with no live sample falls back to its own creation time', () => {
    const matches = [
      match('has-sample', 'o1', '2026-10-01T10:00:00.000Z'),
      match('no-sample', 'o2', '2026-10-05T10:00:00.000Z'),
    ];
    const latest = new Map([['o1', at('2026-10-02T10:00:00.000Z')]]);
    expect(ids(sortWorklistMatches(matches, latest))).toEqual([
      'no-sample',
      'has-sample',
    ]);
  });

  it('keeps one order’s reports together, oldest report first', () => {
    const matches = [
      match(
        'o1-late',
        'o1',
        '2026-10-09T10:00:00.000Z',
        '2026-10-09T10:20:00.000Z',
      ),
      match(
        'o2-only',
        'o2',
        '2026-10-09T09:00:00.000Z',
        '2026-10-09T10:05:00.000Z',
      ),
      match(
        'o1-early',
        'o1',
        '2026-10-09T10:00:00.000Z',
        '2026-10-09T10:10:00.000Z',
      ),
    ];
    const latest = new Map([
      ['o1', at('2026-10-09T10:00:00.000Z')],
      ['o2', at('2026-10-09T09:00:00.000Z')],
    ]);
    expect(ids(sortWorklistMatches(matches, latest))).toEqual([
      'o1-early',
      'o1-late',
      'o2-only',
    ]);
  });

  it('is deterministic whatever order the database returns the rows in', () => {
    const base = [
      match('r1', 'o1', '2026-10-09T10:00:00.000Z'),
      match('r2', 'o2', '2026-10-09T10:00:00.000Z'),
      match('r3', 'o3', '2026-10-09T10:00:00.000Z'),
      match('r4', 'o3', '2026-10-09T10:00:00.000Z', '2026-10-09T15:00:00.000Z'),
    ];
    const latest = new Map([
      ['o1', at('2026-10-09T10:00:00.000Z')],
      ['o2', at('2026-10-09T10:00:00.000Z')],
      ['o3', at('2026-10-09T10:00:00.000Z')],
    ]);
    const expected = ids(sortWorklistMatches(base, latest));
    expect(ids(sortWorklistMatches([...base].reverse(), latest))).toEqual(
      expected,
    );
    expect(
      ids(
        sortWorklistMatches(
          [2, 0, 3, 1].map((i) => base[i]!),
          latest,
        ),
      ),
    ).toEqual(expected);
  });

  it('does not modify its input', () => {
    const matches = [
      match('a', 'o1', '2026-10-01T10:00:00.000Z'),
      match('b', 'o2', '2026-10-05T10:00:00.000Z'),
    ];
    const snapshot = ids(matches);
    sortWorklistMatches(matches, new Map());
    expect(ids(matches)).toEqual(snapshot);
  });
});

/** The database-facing half: ids of one page, branch-scoped sample lookup, chunking. */
describe('LabReportService — worklist paging', () => {
  const findMany = jest.fn();
  const groupBy = jest.fn();
  const prisma = {
    labReport: { findMany },
    orderSample: { groupBy },
  };
  const deps = [prisma, ...(Array(10).fill(undefined) as unknown[])];
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );

  type Priv = {
    pageWorklistReportIds: (
      tenantId: string,
      branchId: string,
      where: object,
      page: number,
      limit: number,
    ) => Promise<{ pageIds: string[]; total: number }>;
    fetchWorklistRowsInOrder: (
      tenantId: string,
      ids: string[],
    ) => Promise<Array<{ id: string }>>;
  };
  const priv = service as unknown as Priv;

  /** What the first (ids-only) query returns for one report. */
  const found = (id: string, orderId: string, orderCreatedAt: string) => ({
    id,
    createdAt: at('2026-10-09T15:00:00.000Z'),
    orderItem: { orderId, order: { createdAt: at(orderCreatedAt) } },
  });

  beforeEach(() => {
    findMany.mockReset();
    groupBy.mockReset();
  });

  it('orders the page by the newest sample, and reports the total over all matches', async () => {
    findMany.mockResolvedValue([
      found('r-old', 'o-old', '2026-10-01T00:00:00.000Z'),
      found('r-draft', 'o-draft', '2026-09-28T00:00:00.000Z'),
      found('r-new', 'o-new', '2026-10-09T14:00:00.000Z'),
    ]);
    groupBy.mockResolvedValue([
      { orderId: 'o-old', _max: { createdAt: at('2026-10-01T00:00:01.000Z') } },
      {
        orderId: 'o-draft',
        _max: { createdAt: at('2026-10-09T16:00:00.000Z') },
      },
      { orderId: 'o-new', _max: { createdAt: at('2026-10-09T14:00:01.000Z') } },
    ]);

    const r = await priv.pageWorklistReportIds('t1', 'b1', {}, 1, 25);

    expect(r).toEqual({ pageIds: ['r-draft', 'r-new', 'r-old'], total: 3 });
  });

  it('slices the requested page out of the full ordering', async () => {
    findMany.mockResolvedValue(
      [1, 2, 3, 4, 5].map((n) =>
        found(`r${n}`, `o${n}`, `2026-10-0${n}T00:00:00.000Z`),
      ),
    );
    groupBy.mockResolvedValue([]); // no samples → order creation time decides: 5,4,3,2,1

    const p1 = await priv.pageWorklistReportIds('t1', 'b1', {}, 1, 2);
    const p2 = await priv.pageWorklistReportIds('t1', 'b1', {}, 2, 2);
    const p3 = await priv.pageWorklistReportIds('t1', 'b1', {}, 3, 2);
    const p4 = await priv.pageWorklistReportIds('t1', 'b1', {}, 4, 2);

    expect(p1).toEqual({ pageIds: ['r5', 'r4'], total: 5 });
    expect(p2).toEqual({ pageIds: ['r3', 'r2'], total: 5 });
    expect(p3).toEqual({ pageIds: ['r1'], total: 5 });
    expect(p4).toEqual({ pageIds: [], total: 5 });
  });

  it('looks samples up for this tenant and branch only, live rows only', async () => {
    findMany.mockResolvedValue([found('r1', 'o1', '2026-10-09T00:00:00.000Z')]);
    groupBy.mockResolvedValue([]);

    await priv.pageWorklistReportIds('t1', 'b1', {}, 1, 25);

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['orderId'],
      where: {
        tenantId: 't1',
        branchId: 'b1',
        deletedAt: null,
        orderId: { in: ['o1'] },
      },
      _max: { createdAt: true },
    });
  });

  it('asks for each order once, even when it has several reports', async () => {
    findMany.mockResolvedValue([
      found('r1', 'o1', '2026-10-09T00:00:00.000Z'),
      found('r2', 'o1', '2026-10-09T00:00:00.000Z'),
      found('r3', 'o2', '2026-10-08T00:00:00.000Z'),
    ]);
    groupBy.mockResolvedValue([]);

    await priv.pageWorklistReportIds('t1', 'b1', {}, 1, 25);

    const calls = groupBy.mock.calls as Array<
      [{ where: { orderId: { in: string[] } } }]
    >;
    expect(calls[0]![0].where.orderId.in).toEqual(['o1', 'o2']);
  });

  it('splits a very large worklist into chunks of 5000 orders', async () => {
    findMany.mockResolvedValue(
      Array.from({ length: 12000 }, (_, i) =>
        found(`r${i}`, `o${i}`, '2026-10-09T00:00:00.000Z'),
      ),
    );
    groupBy.mockResolvedValue([]);

    const r = await priv.pageWorklistReportIds('t1', 'b1', {}, 1, 25);

    expect(r.total).toBe(12000);
    const sizes = (
      groupBy.mock.calls as Array<[{ where: { orderId: { in: string[] } } }]>
    ).map((c) => c[0].where.orderId.in.length);
    expect(sizes).toEqual([5000, 5000, 2000]);
  });

  it('no matches → empty page, and no sample lookup at all', async () => {
    findMany.mockResolvedValue([]);

    const r = await priv.pageWorklistReportIds('t1', 'b1', {}, 1, 25);

    expect(r).toEqual({ pageIds: [], total: 0 });
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('loads the full rows for the page in the given order, for this tenant', async () => {
    findMany.mockResolvedValue([{ id: 'b' }, { id: 'c' }, { id: 'a' }]);

    const rows = await priv.fetchWorklistRowsInOrder('t1', ['a', 'b', 'c']);

    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['a', 'b', 'c'] }, tenantId: 't1' },
      }),
    );
  });

  it('skips a report that disappeared between the two queries, and does not query for an empty page', async () => {
    findMany.mockResolvedValue([{ id: 'a' }, { id: 'c' }]);
    const rows = await priv.fetchWorklistRowsInOrder('t1', ['a', 'b', 'c']);
    expect(rows.map((r) => r.id)).toEqual(['a', 'c']);

    findMany.mockClear();
    expect(await priv.fetchWorklistRowsInOrder('t1', [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
