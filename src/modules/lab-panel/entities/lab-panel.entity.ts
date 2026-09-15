import { LabPanel, LabPanelTest } from '@prisma/client';

/** Domain/response shape for a lab panel (the Prisma model is the DB source of truth). */
export type LabPanelEntity = LabPanel;

/** A resolved classification reference (category/department) embedded in panel reads. */
export interface ClassificationRef {
  id: string;
  name: string;
}

/**
 * A full lab panel enriched with its resolved `category`/`department` objects
 * (`null` when the panel has no category/department). The base read shape used by
 * every panel-returning endpoint.
 */
export type LabPanelWithRefs = LabPanel & {
  category: ClassificationRef | null;
  department: ClassificationRef | null;
};

/**
 * One included test, enriched with the referenced `LabTest`'s display/pricing
 * details (name, code, default sample type, price ladder, discount cap) so the
 * get-one response is self-contained — the caller never needs a second lookup
 * to render the panel's test table. `labTestId` is a logical reference (no
 * Prisma relation, see `LabPanelTest`'s schema comment), so these fields fall
 * back to `null` if the referenced test was hard-deleted or is otherwise
 * unresolvable (soft-deleted tests still resolve normally).
 */
export type LabPanelTestWithDetails = LabPanelTest & {
  testName: string | null;
  testCode: string | null;
  sampleType: string | null;
  priceMsrp: number | null;
  priceOriginal: number | null;
  priceMinimum: number | null;
  priceMaximum: number | null;
  discountCapPct: number | null;
};

/** A lab panel (with refs) composed with its included tests (the get-one response shape). */
export type LabPanelWithTests = LabPanelWithRefs & {
  tests: LabPanelTestWithDetails[];
};

/**
 * One row of the lab-panel listing endpoint: the full panel record enriched with
 * its `category`/`department` objects, plus the count of included tests.
 */
export type LabPanelListRow = LabPanelWithRefs & {
  testsCount: number;
};
