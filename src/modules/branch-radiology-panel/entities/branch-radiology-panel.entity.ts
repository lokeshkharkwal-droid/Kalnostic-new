import { BranchRadiologyPanel, BranchRadiologyPanelTest } from '@prisma/client';

/** Domain/response shape for a branch radiology panel (Prisma model is the DB source of truth). */
export type BranchRadiologyPanelEntity = BranchRadiologyPanel;

/**
 * A `findAll()` list row, denormalised with a human-readable sample summary
 * aggregated across the panel's member tests, plus resolved department/category names.
 */
export interface BranchRadiologyPanelListRow extends BranchRadiologyPanel {
  sampleSummary: string | null;
  departmentName: string | null;
  categoryName: string | null;
}

/** A branch radiology panel composed with its included branch-test rows (get-one shape). */
export type BranchRadiologyPanelWithTests = BranchRadiologyPanel & {
  tests: BranchRadiologyPanelTest[];
};

/**
 * Result of an import: how many source panels were newly copied, how many existing
 * rows were updated (re-snapshotted), and how many source ids were skipped.
 */
export interface BranchRadiologyPanelImportResult {
  copied: number;
  updated: number;
  skipped: number;
}

/**
 * Result of a sync: how many copies were re-snapshotted, how many were soft-deleted
 * because their source no longer exists, and how many were skipped (no source ref).
 */
export interface BranchRadiologyPanelSyncResult {
  synced: number;
  deleted: number;
  skipped: number;
}
