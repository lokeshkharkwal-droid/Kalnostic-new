import { BranchRadiologyPanel, BranchRadiologyPanelTest } from '@prisma/client';

/** Domain/response shape for a branch radiology panel (Prisma model is the DB source of truth). */
export type BranchRadiologyPanelEntity = BranchRadiologyPanel;

/**
 * A `findAll()` list row, denormalised with resolved department/category names
 * (panels have no sub-category, unlike radiology tests) — computed at read time
 * so the Radiology Panel List table doesn't need extra round-trips to render them.
 */
export interface BranchRadiologyPanelListRow extends BranchRadiologyPanel {
  departmentName: string | null;
  categoryName: string | null;
}

/** A branch radiology panel composed with its included branch-test rows (get-one shape). */
export type BranchRadiologyPanelWithTests = BranchRadiologyPanel & {
  tests: BranchRadiologyPanelTest[];
};

/**
 * Result of an import into a list: how many source panels were newly copied, how
 * many existing rows were updated (re-snapshotted), and how many source ids were
 * skipped (not in the branch's master data).
 */
export interface BranchRadiologyPanelImportResult {
  copied: number;
  updated: number;
  skipped: number;
}

/**
 * Result of a sync: how many copies were re-snapshotted, how many were
 * soft-deleted because their source no longer exists, and how many were skipped
 * (no source ref).
 */
export interface BranchRadiologyPanelSyncResult {
  synced: number;
  deleted: number;
  skipped: number;
}
