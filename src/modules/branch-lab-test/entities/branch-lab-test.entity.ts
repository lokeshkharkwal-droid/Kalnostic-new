import { AgeUnit, BranchLabTest, LabTestSample } from '@prisma/client';
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
 * Prisma `select` for a branch test's Age Restriction columns (mirrored from the
 * Master Data test on import/sync). Shared by the Create-Order options and the
 * order-time enforcement so both read the same fields.
 */
export const AGE_RESTRICTION_SELECT = {
  isAgeRestricted: true,
  minAgeValue: true,
  minAgeUnit: true,
  maxAgeValue: true,
  maxAgeUnit: true,
} as const;

/**
 * A branch test's Age Restriction. `isAgeRestricted` false (all bounds `null`)
 * = no age limit; true = the patient's age on the order date must lie inside
 * min..max (min inclusive, max covers its whole unit).
 */
export interface BranchLabTestAgeRestriction {
  isAgeRestricted: boolean;
  minAgeValue: number | null;
  minAgeUnit: AgeUnit | null;
  maxAgeValue: number | null;
  maxAgeUnit: AgeUnit | null;
}

/**
 * An age-restricted member test of a branch panel, carried on the Create-Order
 * panel option so the panel can be checked before it is added.
 */
export interface AgeRestrictedPanelMember {
  branchLabTestId: string;
  testName: string;
  minAgeValue: number;
  minAgeUnit: AgeUnit;
  maxAgeValue: number;
  maxAgeUnit: AgeUnit;
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

/**
 * Result of a sync (reconcile against Master Data): how many copies were newly
 * added, re-snapshotted (updated), soft-deleted (their source no longer exists in
 * Master Data), and how many items belonged to a batch that failed and was skipped
 * so the rest of the sync could continue (partial-failure tolerant).
 */
export interface BranchLabTestSyncResult {
  created: number;
  updated: number;
  deleted: number;
  failed: number;
}
