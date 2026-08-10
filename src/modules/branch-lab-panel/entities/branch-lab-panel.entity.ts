import { BranchLabPanel, BranchLabPanelTest } from '@prisma/client';

/** Domain/response shape for a branch lab panel (Prisma model is the DB source of truth). */
export type BranchLabPanelEntity = BranchLabPanel;

/**
 * A `findAll()` list row, denormalised with a human-readable sample summary
 * aggregated across the panel's member tests (panels have no `configSnapshot`
 * of their own — samples live on each member `BranchLabTest`).
 */
export interface BranchLabPanelListRow extends BranchLabPanel {
  sampleSummary: string | null;
}

/** A branch lab panel composed with its included branch-test rows (get-one shape). */
export type BranchLabPanelWithTests = BranchLabPanel & {
  tests: BranchLabPanelTest[];
};

/**
 * Result of an import into the Walk-in list: how many source panels were newly
 * copied, how many existing rows were updated (re-snapshotted), and how many
 * source ids were skipped (not in the branch's master data).
 */
export interface BranchLabPanelImportResult {
  copied: number;
  updated: number;
  skipped: number;
}

/** Result of a sync: how many copies were re-snapshotted vs skipped (source gone). */
export interface BranchLabPanelSyncResult {
  synced: number;
  skipped: number;
}
