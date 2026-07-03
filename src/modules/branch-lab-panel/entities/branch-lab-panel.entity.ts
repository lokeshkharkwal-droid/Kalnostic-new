import { BranchLabPanel, BranchLabPanelTest } from '@prisma/client';

/** Domain/response shape for a branch lab panel (Prisma model is the DB source of truth). */
export type BranchLabPanelEntity = BranchLabPanel;

/** A branch lab panel composed with its included branch-test rows (get-one shape). */
export type BranchLabPanelWithTests = BranchLabPanel & {
  tests: BranchLabPanelTest[];
};

/** Result of an import: how many source panels were copied vs skipped (already present). */
export interface BranchLabPanelImportResult {
  copied: number;
  skipped: number;
}

/** Result of a sync: how many copies were re-snapshotted vs skipped (source gone). */
export interface BranchLabPanelSyncResult {
  synced: number;
  skipped: number;
}
