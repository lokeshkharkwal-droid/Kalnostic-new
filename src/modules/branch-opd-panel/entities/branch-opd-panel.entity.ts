import { BranchOpdPanel, BranchOpdPanelTest } from '@prisma/client';

/** Domain/response shape for a branch opd panel (Prisma model is the DB source of truth). */
export type BranchOpdPanelEntity = BranchOpdPanel;

/**
 * A `findAll()` list row, denormalised with a human-readable sample summary
 * aggregated across the panel's member tests, plus resolved department/category names.
 */
export interface BranchOpdPanelListRow extends BranchOpdPanel {
  sampleSummary: string | null;
  departmentName: string | null;
  categoryName: string | null;
}

/** A branch opd panel composed with its included branch-test rows (get-one shape). */
export type BranchOpdPanelWithTests = BranchOpdPanel & {
  tests: BranchOpdPanelTest[];
};

/**
 * Result of an import: how many source panels were newly copied, how many existing
 * rows were updated (re-snapshotted), and how many source ids were skipped.
 */
export interface BranchOpdPanelImportResult {
  copied: number;
  updated: number;
  skipped: number;
}

/**
 * Result of a sync: how many copies were re-snapshotted, how many were soft-deleted
 * because their source no longer exists, and how many were skipped (no source ref).
 */
export interface BranchOpdPanelSyncResult {
  synced: number;
  deleted: number;
  skipped: number;
}
