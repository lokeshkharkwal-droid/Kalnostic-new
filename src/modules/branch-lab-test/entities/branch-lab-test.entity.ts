import { BranchLabTest, LabTestSample } from '@prisma/client';
import { LabTestResultParamWithRefs } from '../../lab-test/entities/lab-test.entity';

/** Domain/response shape for a branch lab test (Prisma model is the DB source of truth). */
export type BranchLabTestEntity = BranchLabTest;

/**
 * A `findAll()` list row, denormalised with names for its classification ids
 * and a human-readable sample summary — both computed at read time so the
 * Lab Test List table doesn't need extra round-trips to render them.
 */
export interface BranchLabTestListRow extends BranchLabTest {
  departmentName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  sampleSummary: string | null;
}

/**
 * The point-in-time clinical snapshot stored in `BranchLabTest.configSnapshot`:
 * the source Master Data test's samples and result parameters (each with its
 * reference ranges/values), copied verbatim at import/sync time.
 */
export interface BranchLabTestConfigSnapshot {
  samples: LabTestSample[];
  resultParams: LabTestResultParamWithRefs[];
}

/**
 * Result of an import into the Walk-in list: how many source tests were newly
 * copied, how many existing rows were updated (re-snapshotted), and how many
 * source ids were skipped (not in the branch's master data).
 */
export interface BranchLabTestImportResult {
  copied: number;
  updated: number;
  skipped: number;
}

/** Result of a sync: how many copies were re-snapshotted vs skipped (source gone). */
export interface BranchLabTestSyncResult {
  synced: number;
  skipped: number;
}
