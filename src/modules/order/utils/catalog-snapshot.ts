/**
 * Versioned snapshot of the catalogue test/panel as it was when an order line
 * was created (stored in `OrderItem.catalogSnapshot`). Master-data edits/syncs
 * update BranchLabTest/Panel in place, so this is what keeps an existing order
 * showing what was actually sold. `OrderItem.unitPrice` stays the authoritative
 * charged amount; the prices in here are provenance only.
 */
export interface CatalogSnapshot {
  v: 1;
  kind: 'TEST' | 'PANEL';
  name: string;
  displayName?: string | null;
  code: string;
  departmentId: string | null;
  listId: string | null;
  listPrice: number;
  emergencyPrice?: number;
  priceMsrp: number;
  isAllowDiscounts: boolean;
  tat: {
    minValue: number | null;
    minUnit: string | null;
    maxValue: number | null;
    maxUnit: string | null;
  };
  schedule?: { days: string[]; from: string | null; to: string | null };
  capturedAt: string;
  backfilled?: boolean;
}

/** Fields read from a BranchLabTest row to build a snapshot. */
export interface SnapshotTestSource {
  testName: string;
  testDisplayName: string | null;
  testCode: string;
  departmentId: string | null;
  listId: string | null;
  listPrice: number;
  emergencyPrice: number;
  priceMsrp: number;
  isAllowDiscounts: boolean;
  tatMinValue: number | null;
  tatMinUnit: string | null;
  tatMaxValue: number | null;
  tatMaxUnit: string | null;
  scheduleDays: string[];
  scheduleFrom: string | null;
  scheduleTo: string | null;
}

/** Fields read from a BranchLabPanel row to build a snapshot. */
export interface SnapshotPanelSource {
  panelName: string;
  panelCode: string;
  departmentId: string | null;
  listId: string | null;
  listPrice: number;
  priceMsrp: number;
  isDisableDiscount: boolean;
  tatMinValue: number | null;
  tatMinUnit: string | null;
  tatMaxValue: number | null;
  tatMaxUnit: string | null;
}

/** Build the snapshot of a lab test as it is right now. */
export function buildTestSnapshot(
  t: SnapshotTestSource,
  now: Date = new Date(),
): CatalogSnapshot {
  return {
    v: 1,
    kind: 'TEST',
    name: t.testDisplayName ?? t.testName,
    displayName: t.testDisplayName,
    code: t.testCode,
    departmentId: t.departmentId,
    listId: t.listId,
    listPrice: t.listPrice,
    emergencyPrice: t.emergencyPrice,
    priceMsrp: t.priceMsrp,
    isAllowDiscounts: t.isAllowDiscounts,
    tat: {
      minValue: t.tatMinValue,
      minUnit: t.tatMinUnit,
      maxValue: t.tatMaxValue,
      maxUnit: t.tatMaxUnit,
    },
    schedule: {
      days: t.scheduleDays,
      from: t.scheduleFrom,
      to: t.scheduleTo,
    },
    capturedAt: now.toISOString(),
  };
}

/** Build the snapshot of a lab panel as it is right now. */
export function buildPanelSnapshot(
  p: SnapshotPanelSource,
  now: Date = new Date(),
): CatalogSnapshot {
  return {
    v: 1,
    kind: 'PANEL',
    name: p.panelName,
    code: p.panelCode,
    departmentId: p.departmentId,
    listId: p.listId,
    listPrice: p.listPrice,
    priceMsrp: p.priceMsrp,
    isAllowDiscounts: !p.isDisableDiscount,
    tat: {
      minValue: p.tatMinValue,
      minUnit: p.tatMinUnit,
      maxValue: p.tatMaxValue,
      maxUnit: p.tatMaxUnit,
    },
    capturedAt: now.toISOString(),
  };
}

/**
 * Whether an update must keep a kept line's stored price/snapshot untouched.
 * Only an order that is already active (billed) is frozen; DRAFT / APPOINTMENT /
 * QUOTE rows haven't been billed yet, so they keep following the current list.
 */
export function shouldFreezeKeptLines(wasActiveOrder: boolean): boolean {
  return wasActiveOrder;
}
