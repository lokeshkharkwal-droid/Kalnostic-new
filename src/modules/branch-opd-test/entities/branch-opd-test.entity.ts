import { BranchOpdTest, OpdTestSample } from '@prisma/client';
import { OpdTestResultParamWithRefs } from '../../opd-test/entities/opd-test.entity';

/** Domain/response shape for a branch opd test (Prisma model is the DB source of truth). */
export type BranchOpdTestEntity = BranchOpdTest;

/**
 * A `findAll()` list row, denormalised with names for its classification ids and a
 * human-readable sample summary — both computed at read time.
 */
export interface BranchOpdTestListRow extends BranchOpdTest {
  departmentName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  sampleSummary: string | null;
}

/**
 * The point-in-time clinical snapshot stored in `BranchOpdTest.configSnapshot`:
 * the source Master Data test's samples and result parameters (each with its
 * reference ranges/values), copied verbatim at import/sync time.
 */
export interface BranchOpdTestConfigSnapshot {
  samples: OpdTestSample[];
  resultParams: OpdTestResultParamWithRefs[];
}

/**
 * Result of an import: how many source tests were newly copied, how many existing
 * rows were updated (re-snapshotted), and how many source ids were skipped.
 */
export interface BranchOpdTestImportResult {
  copied: number;
  updated: number;
  skipped: number;
}

/**
 * Result of a sync: how many copies were re-snapshotted, how many were soft-deleted
 * because their source no longer exists, and how many were skipped (no source ref).
 */
export interface BranchOpdTestSyncResult {
  synced: number;
  deleted: number;
  skipped: number;
}
