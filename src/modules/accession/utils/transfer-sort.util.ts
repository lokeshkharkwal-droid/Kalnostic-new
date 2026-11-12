import { Prisma } from '@prisma/client';

/**
 * Columns the Internal / External / Outsourced queues can be sorted by (`sortBy`).
 * Test Name is deliberately absent: it waits for the "one row per barcode" decision.
 */
export const TRANSFER_SORT_KEYS = [
  // read straight from the transfer / its sample / its order
  'orderCode',
  'orderDate',
  'barcode',
  'patientName',
  'sendDate',
  'transferStatus',
  'outsourceStatus',
  'externalPartnerName',
  'logisticsType',
  'logisticsPerson',
  'sampleForm',
  // names resolved in the service (the branch / center / department is only an id on the row)
  'department',
  'originBranch',
  'destinationBranch',
  'outsourceCenter',
] as const;

export type TransferSortKey = (typeof TRANSFER_SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

/** The sorts that need a name looked up first, because the row only holds an id. */
export const DERIVED_TRANSFER_SORT_KEYS = [
  'department',
  'originBranch',
  'destinationBranch',
  'outsourceCenter',
] as const;

export type DerivedTransferSortKey =
  (typeof DERIVED_TRANSFER_SORT_KEYS)[number];

export function isDerivedTransferSort(
  key: TransferSortKey | undefined,
): key is DerivedTransferSortKey {
  return (
    key !== undefined &&
    (DERIVED_TRANSFER_SORT_KEYS as readonly string[]).includes(key)
  );
}

/** Newest first, id as the tie-breaker so paging never repeats or skips a row. */
const DEFAULT_ORDER: Prisma.SampleTransferOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

/** The plain column, rows with no value always last whichever way it is sorted. */
const col = (dir: SortDirection) => ({
  sort: dir,
  nulls: 'last' as const,
});

/**
 * Prisma `orderBy` for a sort Prisma can do itself, ending with the default order as the
 * tie-breaker. `undefined` sort = the default order (newest first).
 * @param sortBy a key that is not one of {@link DERIVED_TRANSFER_SORT_KEYS}
 */
export function transferOrderBy(
  sortBy: Exclude<TransferSortKey, DerivedTransferSortKey> | undefined,
  dir: SortDirection = 'asc',
): Prisma.SampleTransferOrderByWithRelationInput[] {
  if (!sortBy) return DEFAULT_ORDER;
  const order = (): Prisma.SampleTransferOrderByWithRelationInput[] => {
    switch (sortBy) {
      case 'orderCode':
        return [{ sample: { order: { orderCode: dir } } }];
      case 'orderDate':
        return [{ sample: { order: { orderDate: dir } } }];
      case 'barcode':
        return [{ sample: { barcode: col(dir) } }];
      case 'patientName':
        return [
          { sample: { order: { patient: { firstName: dir } } } },
          { sample: { order: { patient: { lastName: col(dir) } } } },
        ];
      case 'sendDate':
        return [{ sendDate: col(dir) }, { sendTime: col(dir) }];
      case 'transferStatus':
        // the enum is declared in lifecycle order (In Transit ... Rejected)
        return [{ transferStatus: dir }];
      case 'outsourceStatus':
        return [{ outsourceStatus: col(dir) }];
      case 'externalPartnerName':
        return [{ externalPartnerName: col(dir) }];
      case 'logisticsType':
        return [{ logisticsType: col(dir) }];
      case 'logisticsPerson':
        return [{ logisticsPerson: col(dir) }];
      case 'sampleForm':
        return [{ sampleForm: col(dir) }];
    }
  };
  return [...order(), ...DEFAULT_ORDER];
}

/** One row of a derived sort: its id and the text to sort by (null = nothing to show). */
export interface SortLabelRow {
  id: string;
  label: string | null;
}

/**
 * Order rows by a resolved name: alphabetical ignoring capitals and accents, rows with no
 * name always last (whichever way), equal names keep the order they arrived in (newest first,
 * since the caller loads them that way).
 * @returns the ids in sorted order
 */
export function sortIdsByLabel(
  rows: readonly SortLabelRow[],
  dir: SortDirection,
): string[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ ...row, index }))
    .sort((a, b) => {
      if (a.label === null || a.label === '') {
        if (b.label === null || b.label === '') return a.index - b.index;
        return 1;
      }
      if (b.label === null || b.label === '') return -1;
      const byName = a.label.localeCompare(b.label, undefined, {
        sensitivity: 'base',
      });
      return byName !== 0 ? sign * byName : a.index - b.index;
    })
    .map((r) => r.id);
}
