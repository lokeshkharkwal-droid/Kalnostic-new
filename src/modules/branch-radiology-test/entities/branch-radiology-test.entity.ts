import { BranchRadiologyTest, RadiologyTestSample } from '@prisma/client';
import { RadiologyTestResultParamWithRefs } from '../../radiology-test/entities/radiology-test.entity';

/** Domain/response shape for a branch radiology test (Prisma model is the DB source of truth). */
export type BranchRadiologyTestEntity = BranchRadiologyTest;

/**
 * A `findAll()` list row, denormalised with names for its classification ids and a
 * human-readable sample summary — both computed at read time.
 */
export interface BranchRadiologyTestListRow extends BranchRadiologyTest {
  departmentName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  sampleSummary: string | null;
}

/**
 * The point-in-time clinical snapshot stored in `BranchRadiologyTest.configSnapshot`:
 * the source Master Data test's samples and result parameters (each with its
 * reference ranges/values), copied verbatim at import/sync time.
 */
export interface BranchRadiologyTestConfigSnapshot {
  samples: RadiologyTestSample[];
  resultParams: RadiologyTestResultParamWithRefs[];
}

/**
 * Result of an import: how many source tests were newly copied, how many existing
 * rows were updated (re-snapshotted), and how many source ids were skipped.
 */
export interface BranchRadiologyTestImportResult {
  copied: number;
  updated: number;
  skipped: number;
}

/**
 * Result of a sync: how many copies were re-snapshotted, how many were soft-deleted
 * because their source no longer exists, and how many were skipped (no source ref).
 */
export interface BranchRadiologyTestSyncResult {
  synced: number;
  deleted: number;
  skipped: number;
}
