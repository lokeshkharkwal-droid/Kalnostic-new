import { BranchRadiologyTest } from '@prisma/client';

/** Domain/response shape for a branch radiology test (Prisma model is the DB source of truth). */
export type BranchRadiologyTestEntity = BranchRadiologyTest;

/**
 * A `findAll()` list row, denormalised with names for its classification ids —
 * computed at read time so the Radiology Test List table doesn't need extra
 * round-trips to render them.
 */
export interface BranchRadiologyTestListRow extends BranchRadiologyTest {
  departmentName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
}

/**
 * Result of an import into a list: how many source tests were newly copied, how
 * many existing rows were updated (re-snapshotted), and how many source ids were
 * skipped (not in the branch's master data).
 */
export interface BranchRadiologyTestImportResult {
  copied: number;
  updated: number;
  skipped: number;
}

/**
 * Result of a sync: how many copies were re-snapshotted, how many were
 * soft-deleted because their source no longer exists, and how many were skipped
 * (no source ref).
 */
export interface BranchRadiologyTestSyncResult {
  synced: number;
  deleted: number;
  skipped: number;
}
