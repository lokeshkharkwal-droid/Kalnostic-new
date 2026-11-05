import {
  COUNTED_SAMPLE_WHERE,
  buildCollectionProgressWhere,
  collectionProgressByOrder,
  deriveCollectionProgress,
} from './collection-progress.util';

describe('deriveCollectionProgress', () => {
  it('reads PENDING when nothing counts or nothing is collected', () => {
    expect(deriveCollectionProgress(0, 0)).toBe('PENDING');
    expect(deriveCollectionProgress(0, 3)).toBe('PENDING');
  });

  it('reads PARTIAL when some but not all are collected', () => {
    expect(deriveCollectionProgress(1, 3)).toBe('PARTIAL');
  });

  it('reads COLLECTED when every counted sample is collected', () => {
    expect(deriveCollectionProgress(3, 3)).toBe('COLLECTED');
  });
});

describe('COUNTED_SAMPLE_WHERE', () => {
  it('leaves out deleted and cancelled samples', () => {
    expect(COUNTED_SAMPLE_WHERE.deletedAt).toBeNull();
    expect(COUNTED_SAMPLE_WHERE.status).toEqual({ not: 'CANCELLED' });
  });

  it('keeps a sample with no test links, or with at least one live item; drops a frozen one', () => {
    // frozen = has live links and EVERY one belongs to a removed item
    expect(COUNTED_SAMPLE_WHERE.OR).toEqual([
      { tests: { none: { deletedAt: null } } },
      { tests: { some: { deletedAt: null, orderItem: { deletedAt: null } } } },
    ]);
  });
});

describe('buildCollectionProgressWhere (samples, not the item flag)', () => {
  const json = (s: 'PENDING' | 'PARTIAL' | 'COLLECTED') =>
    JSON.stringify(buildCollectionProgressWhere(s));

  it('never reads OrderItem.collectedAt any more', () => {
    for (const s of ['PENDING', 'PARTIAL', 'COLLECTED'] as const) {
      // the only `collectedAt` left must sit under `orderSamples`
      const where = buildCollectionProgressWhere(s) as {
        AND: Array<Record<string, unknown>>;
      };
      for (const clause of where.AND) {
        const text = JSON.stringify(clause);
        if (text.includes('collectedAt')) {
          expect(Object.keys(clause)).toEqual(['orderSamples']);
        }
      }
    }
  });

  it('PENDING = has workflow items and no counted sample collected', () => {
    const w = buildCollectionProgressWhere('PENDING') as {
      AND: Array<Record<string, unknown>>;
    };
    expect(w.AND[0]).toHaveProperty('items');
    expect(w.AND[1]).toHaveProperty('orderSamples.none');
    expect(json('PENDING')).toContain('"collectedAt":{"not":null}');
  });

  it('COLLECTED = at least one counted sample and none uncollected', () => {
    const w = buildCollectionProgressWhere('COLLECTED') as {
      AND: Array<Record<string, unknown>>;
    };
    expect(w.AND[0]).toHaveProperty('orderSamples.some');
    expect(w.AND[1]).toHaveProperty('orderSamples.none');
    expect(json('COLLECTED')).toContain('"collectedAt":null');
  });

  it('PARTIAL = some collected and some uncollected', () => {
    const w = buildCollectionProgressWhere('PARTIAL') as {
      AND: Array<Record<string, unknown>>;
    };
    expect(w.AND[0]).toHaveProperty('orderSamples.some');
    expect(w.AND[1]).toHaveProperty('orderSamples.some');
  });
});

describe('collectionProgressByOrder', () => {
  const makeDb = (
    total: Array<{ orderId: string; n: number }>,
    collected: Array<{ orderId: string; n: number }>,
  ) => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce(
        total.map((r) => ({ orderId: r.orderId, _count: { _all: r.n } })),
      )
      .mockResolvedValueOnce(
        collected.map((r) => ({ orderId: r.orderId, _count: { _all: r.n } })),
      );
    return { db: { orderSample: { groupBy } } as never, groupBy };
  };

  it('does no query for an empty page', async () => {
    const { db, groupBy } = makeDb([], []);
    expect((await collectionProgressByOrder(db, 't1', [])).size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('maps each order: none / some / all collected, and an order with no samples', async () => {
    const { db } = makeDb(
      [
        { orderId: 'none', n: 2 },
        { orderId: 'some', n: 2 },
        { orderId: 'all', n: 2 },
      ],
      [
        { orderId: 'some', n: 1 },
        { orderId: 'all', n: 2 },
      ],
    );
    const r = await collectionProgressByOrder(db, 't1', [
      'none',
      'some',
      'all',
      'nosamples',
    ]);
    expect(r.get('none')).toBe('PENDING');
    expect(r.get('some')).toBe('PARTIAL');
    expect(r.get('all')).toBe('COLLECTED');
    expect(r.get('nosamples')).toBe('PENDING');
  });

  it('counts only counted samples, scoped to the tenant and the page orders', async () => {
    const { db, groupBy } = makeDb([], []);
    await collectionProgressByOrder(db, 't1', ['o1']);
    expect(groupBy).toHaveBeenCalledTimes(2);
    const totalWhere = JSON.stringify(groupBy.mock.calls[0][0].where);
    const collectedWhere = JSON.stringify(groupBy.mock.calls[1][0].where);
    for (const w of [totalWhere, collectedWhere]) {
      expect(w).toContain('"tenantId":"t1"');
      expect(w).toContain('"orderId":{"in":["o1"]}');
      expect(w).toContain('"status":{"not":"CANCELLED"}');
    }
    expect(collectedWhere).toContain('"collectedAt":{"not":null}');
    expect(totalWhere).not.toContain('"collectedAt":{"not":null}');
  });
});
