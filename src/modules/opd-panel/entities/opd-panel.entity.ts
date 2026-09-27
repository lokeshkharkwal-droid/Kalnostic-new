import { OpdPanel, OpdPanelTest } from '@prisma/client';

/** Domain/response shape for a opd panel (the Prisma model is the DB source of truth). */
export type OpdPanelEntity = OpdPanel;

/** A resolved classification reference (category/department) embedded in panel reads. */
export interface ClassificationRef {
  id: string;
  name: string;
}

/**
 * A full opd panel enriched with its resolved `category`/`department`
 * objects (`null` when absent).
 */
export type OpdPanelWithRefs = OpdPanel & {
  category: ClassificationRef | null;
  department: ClassificationRef | null;
};

/**
 * One included test, enriched with the referenced `OpdTest`'s
 * display/pricing details. `labTestId` is a logical reference (no Prisma relation),
 * so these fields fall back to `null` if the referenced test is unresolvable.
 */
export type OpdPanelTestWithDetails = OpdPanelTest & {
  testName: string | null;
  testCode: string | null;
  sampleType: string | null;
  priceMsrp: number | null;
  priceOriginal: number | null;
  priceMinimum: number | null;
  priceMaximum: number | null;
  discountCapPct: number | null;
};

/** A opd panel (with refs) composed with its included tests. */
export type OpdPanelWithTests = OpdPanelWithRefs & {
  tests: OpdPanelTestWithDetails[];
};

/**
 * One row of the opd-panel listing endpoint: the full panel record enriched
 * with its `category`/`department` objects, plus the count of included tests.
 */
export type OpdPanelListRow = OpdPanelWithRefs & {
  testsCount: number;
};
