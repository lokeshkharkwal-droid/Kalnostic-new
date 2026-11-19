import { SampleStatus } from '@prisma/client';
import {
  collectionRank,
  inHouseOrderBy,
  IN_HOUSE_SORT_KEYS,
  isOrderLevelSort,
  orderIdsBySampleValue,
  ORDER_LEVEL_SORT_KEYS,
  sampleStatusRank,
  sendMoment,
  type OrderSortSample,
} from './in-house-sort.util';

const at = (d: string) => new Date(`2026-11-${d}T10:00:00Z`);
const s = (
  orderId: string,
  value: number | string | null,
  day = '01',
): OrderSortSample => ({ orderId, createdAt: at(day), value });

describe('orderIdsBySampleValue', () => {
  it('sorts orders by their smallest value ascending and their largest descending', () => {
    const samples = [s('A', 5), s('A', 1), s('B', 3), s('B', 9), s('C', 4)];
    // asc: A(1) < B(3) < C(4); desc: B(9) > A(5) > C(4)
    expect(orderIdsBySampleValue(samples, 'asc')).toEqual(['A', 'B', 'C']);
    expect(orderIdsBySampleValue(samples, 'desc')).toEqual(['B', 'A', 'C']);
  });

  it('puts orders with no value last, whichever way it is sorted', () => {
    const samples = [s('A', null), s('B', 2), s('C', 1)];
    expect(orderIdsBySampleValue(samples, 'asc')).toEqual(['C', 'B', 'A']);
    expect(orderIdsBySampleValue(samples, 'desc')).toEqual(['B', 'C', 'A']);
  });

  it('ignores an empty sample when the order has another one with a value', () => {
    const samples = [s('A', null), s('A', 7), s('B', 3)];
    expect(orderIdsBySampleValue(samples, 'asc')).toEqual(['B', 'A']);
  });

  it('sorts text without caring about capitals, and numbers inside text by size', () => {
    const samples = [s('A', 'b-10'), s('B', 'B-2'), s('C', 'a-1')];
    expect(orderIdsBySampleValue(samples, 'asc')).toEqual(['C', 'B', 'A']);
  });

  it('returns each order once and keeps paging stable: equal values go newest sample first, then by id', () => {
    const samples = [
      s('A', 1, '01'),
      s('B', 1, '05'),
      s('C', 1, '05'),
      s('D', 1, '03'),
    ];
    const asc = orderIdsBySampleValue(samples, 'asc');
    expect(asc).toEqual(['C', 'B', 'D', 'A']);
    expect(orderIdsBySampleValue(samples, 'asc')).toEqual(asc);
    expect(new Set(asc).size).toBe(4);
  });

  it('an empty list gives an empty page', () => {
    expect(orderIdsBySampleValue([], 'asc')).toEqual([]);
  });
});

describe('in-house sort keys', () => {
  it('every key is either sorted by the database on the order or from the samples', () => {
    expect(IN_HOUSE_SORT_KEYS).toHaveLength(12);
    expect(
      ORDER_LEVEL_SORT_KEYS.every((k) => IN_HOUSE_SORT_KEYS.includes(k)),
    ).toBe(true);
    expect(isOrderLevelSort('patientName')).toBe(true);
    expect(isOrderLevelSort('barcode')).toBe(false);
    expect(isOrderLevelSort(undefined)).toBe(false);
  });

  it('every order-level key builds an order-by that ends with the newest-first tie-break', () => {
    for (const key of ORDER_LEVEL_SORT_KEYS) {
      const by = inHouseOrderBy(key, 'desc');
      expect(by.slice(-2)).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      expect(by.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('patient sorts by first name, then last name (a missing last name last)', () => {
    expect(inHouseOrderBy('patientName', 'desc').slice(0, 2)).toEqual([
      { patient: { firstName: 'desc' } },
      { patient: { lastName: { sort: 'desc', nulls: 'last' } } },
    ]);
  });
});

describe('value helpers', () => {
  it('sample status follows the workflow order', () => {
    expect(sampleStatusRank(SampleStatus.NEW)).toBeLessThan(
      sampleStatusRank(SampleStatus.COLLECTED),
    );
    expect(sampleStatusRank(SampleStatus.COLLECTED)).toBeLessThan(
      sampleStatusRank(SampleStatus.ACCEPTED),
    );
    expect(sampleStatusRank(SampleStatus.ACCEPTED)).toBeLessThan(
      sampleStatusRank(SampleStatus.OUTSOURCED),
    );
  });

  it('collection goes Pending, Partial, Collected', () => {
    expect(collectionRank('PENDING')).toBeLessThan(collectionRank('PARTIAL'));
    expect(collectionRank('PARTIAL')).toBeLessThan(collectionRank('COLLECTED'));
  });

  it('send moment is the date plus the time; no date means nothing to sort', () => {
    const d = new Date('2026-11-01T00:00:00Z');
    expect(sendMoment(d, '14:30')).toBe(d.getTime() + (14 * 60 + 30) * 60000);
    expect(sendMoment(d, null)).toBe(d.getTime());
    expect(sendMoment(d, 'garbage')).toBe(d.getTime());
    expect(sendMoment(null, '10:00')).toBeNull();
  });
});
