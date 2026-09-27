import { RadiologyPanel, RadiologyPanelTest } from '@prisma/client';

/** Domain/response shape for a radiology panel (the Prisma model is the DB source of truth). */
export type RadiologyPanelEntity = RadiologyPanel;

/** A resolved classification reference (category/department) embedded in panel reads. */
export interface ClassificationRef {
  id: string;
  name: string;
}

/**
 * A full radiology panel enriched with its resolved `category`/`department`
 * objects (`null` when absent).
 */
export type RadiologyPanelWithRefs = RadiologyPanel & {
  category: ClassificationRef | null;
  department: ClassificationRef | null;
};

/**
 * One included test, enriched with the referenced `RadiologyTest`'s
 * display/pricing details. `labTestId` is a logical reference (no Prisma relation),
 * so these fields fall back to `null` if the referenced test is unresolvable.
 */
export type RadiologyPanelTestWithDetails = RadiologyPanelTest & {
  testName: string | null;
  testCode: string | null;
  sampleType: string | null;
  priceMsrp: number | null;
  priceOriginal: number | null;
  priceMinimum: number | null;
  priceMaximum: number | null;
  discountCapPct: number | null;
};

/** A radiology panel (with refs) composed with its included tests. */
export type RadiologyPanelWithTests = RadiologyPanelWithRefs & {
  tests: RadiologyPanelTestWithDetails[];
};

/**
 * One row of the radiology-panel listing endpoint: the full panel record enriched
 * with its `category`/`department` objects, plus the count of included tests.
 */
export type RadiologyPanelListRow = RadiologyPanelWithRefs & {
  testsCount: number;
};
