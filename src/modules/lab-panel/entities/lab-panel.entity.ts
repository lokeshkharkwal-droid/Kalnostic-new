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

/** A lab panel (with refs) composed with its included tests (the get-one response shape). */
export type LabPanelWithTests = LabPanelWithRefs & {
  tests: LabPanelTest[];
};

/**
 * One row of the lab-panel listing endpoint: the full panel record enriched with
 * its `category`/`department` objects, plus the count of included tests.
 */
export type LabPanelListRow = LabPanelWithRefs & {
  testsCount: number;
};
