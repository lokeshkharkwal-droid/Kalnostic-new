import { Prisma, SampleStatus } from '@prisma/client';
import type { CollectionProgress } from '../../../common/utils/collection-progress.util';
import type { SortDirection } from './transfer-sort.util';

/**
 * Columns the In-House list can be sorted by (`sortBy`). The checkbox, View and Actions
 * columns are not data and are not listed.
 */
export const IN_HOUSE_SORT_KEYS = [
  // read from the order, or the patient it points to
  'orderCode',
  'orderDate',
  'patientName',
  // worked out from the order's samples (and the doctor / panel on the order)
  'referredBy',
  'referralPanel',
  'collectionStatus',
  'barcode',
  'testName',
  'department',
  'sampleStatus',
  'sendDetails',
  'tat',
] as const;

export type InHouseSortKey = (typeof IN_HOUSE_SORT_KEYS)[number];

/**
 * The sorts the database can do on the order itself (no look at the samples needed). Only columns
 * every order has: a column an order may lack (doctor, panel) cannot be put "last" both ways by
 * the database, so those are ranked from the samples like the rest.
 */
export const ORDER_LEVEL_SORT_KEYS = [
  'orderCode',
  'orderDate',
  'patientName',
] as const;

export type OrderLevelSortKey = (typeof ORDER_LEVEL_SORT_KEYS)[number];

export function isOrderLevelSort(
  key: InHouseSortKey | undefined,
): key is OrderLevelSortKey {
  return (
    key !== undefined &&
    (ORDER_LEVEL_SORT_KEYS as readonly string[]).includes(key)
  );
}

/** Newest order first, id as the tie-breaker so paging never repeats or skips an order. */
const TIE_BREAK: Prisma.OrderOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

/**
 * Prisma `orderBy` (on the Order) for a column the order itself holds. Ends with the
 * newest-first tie-break.
 * @param key an order-level key
 * @param dir sort direction
 */
export function inHouseOrderBy(
  key: OrderLevelSortKey,
  dir: SortDirection,
): Prisma.OrderOrderByWithRelationInput[] {
  const order = (): Prisma.OrderOrderByWithRelationInput[] => {
    switch (key) {
      case 'orderCode':
        return [{ orderCode: dir }];
      case 'orderDate':
        return [{ orderDate: dir }];
      case 'patientName':
        return [
          { patient: { firstName: dir } },
          { patient: { lastName: { sort: dir, nulls: 'last' } } },
        ];
    }
  };
  return [...order(), ...TIE_BREAK];
}

/** What one sample says about its order for a sort: the value to rank by (null = nothing to show). */
export interface OrderSortSample {
  orderId: string;
  createdAt: Date;
  value: number | string | null;
}

const COLLATE = { sensitivity: 'base', numeric: true } as const;

/** Order of two non-null values: numbers by size, text alphabetically (capitals and accents ignored, 2 before 10). */
function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, COLLATE);
}

/**
 * The orders in sorted order. An order has many samples, so it is ranked by its smallest value
 * when sorting ascending and its largest when sorting descending (so the order that holds the
 * "first" sample leads either way). Orders with no value are always last, whichever way. Equal
 * orders keep newest-first (the newest sample), then the id, so paging is stable.
 * @param samples one entry per sample of the orders that match the filters
 * @param dir sort direction
 * @returns each order id once, in sorted order
 */
export function orderIdsBySampleValue(
  samples: readonly OrderSortSample[],
  dir: SortDirection,
): string[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byOrder = new Map<
    string,
    { value: number | string | null; newest: number }
  >();
  for (const s of samples) {
    const cur = byOrder.get(s.orderId);
    const created = s.createdAt.getTime();
    if (!cur) {
      byOrder.set(s.orderId, { value: s.value, newest: created });
      continue;
    }
    cur.newest = Math.max(cur.newest, created);
    if (s.value === null) continue;
    if (cur.value === null || sign * compareValues(s.value, cur.value) < 0) {
      cur.value = s.value;
    }
  }
  return [...byOrder.entries()]
    .sort(([idA, a], [idB, b]) => {
      const aNone = a.value === null || a.value === '';
      const bNone = b.value === null || b.value === '';
      if (aNone !== bNone) return aNone ? 1 : -1;
      if (!aNone && !bNone) {
        const byValue = sign * compareValues(a.value!, b.value!);
        if (byValue !== 0) return byValue;
      }
      if (a.newest !== b.newest) return b.newest - a.newest;
      return idA < idB ? 1 : idA > idB ? -1 : 0;
    })
    .map(([id]) => id);
}

/** Sample status in workflow order: the order the enum is declared in (New ... Outsourced). */
const STATUS_RANK = new Map<string, number>(
  Object.values(SampleStatus).map((s, i) => [s, i]),
);

/** The workflow position of a sample status. */
export function sampleStatusRank(status: SampleStatus): number {
  return STATUS_RANK.get(status) ?? STATUS_RANK.size;
}

const COLLECTION_RANK: Record<CollectionProgress, number> = {
  PENDING: 0,
  PARTIAL: 1,
  COLLECTED: 2,
};

/** Pending, then Partial, then Collected. */
export function collectionRank(progress: CollectionProgress): number {
  return COLLECTION_RANK[progress];
}

/**
 * The moment a transfer was dispatched: the send date plus the "HH:mm" time when one was given.
 * Null when no date was given (the column shows no date then).
 */
export function sendMoment(
  sendDate: Date | null,
  sendTime: string | null,
): number | null {
  if (!sendDate) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec((sendTime ?? '').trim());
  const minutes = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  return sendDate.getTime() + minutes * 60000;
}
