import { BranchLabTest, LabTestSample } from '@prisma/client';
import { LabTestResultParamWithRefs } from '../../lab-test/entities/lab-test.entity';

/** Domain/response shape for a branch lab test (Prisma model is the DB source of truth). */
export type BranchLabTestEntity = BranchLabTest;

/**
 * The point-in-time clinical snapshot stored in `BranchLabTest.configSnapshot`:
 * the source Master Data test's samples and result parameters (each with its
 * reference ranges/values), copied verbatim at import/sync time.
 */
export interface BranchLabTestConfigSnapshot {
  samples: LabTestSample[];
  resultParams: LabTestResultParamWithRefs[];
}

/** Result of an import: how many source tests were copied vs skipped (already present). */
export interface BranchLabTestImportResult {
  copied: number;
  skipped: number;
}

/** Result of a sync: how many copies were re-snapshotted vs skipped (source gone). */
export interface BranchLabTestSyncResult {
  synced: number;
  skipped: number;
}
