import { Prisma } from '@prisma/client';

/**
 * Progress events emitted by the Tenant → Branch Master Data sync
 * (`LabTestService.syncTestsIntoBranch` + `LabPanelService.syncTenantToBranch`).
 *
 * They are REPORTING ONLY: the sync stays one atomic transaction, so a
 * "processed" test is written inside that transaction but not committed until
 * the whole import commits. Listeners run inline (awaited) — keep them cheap.
 */

/** Tests are reported in batches of this many (the dialog's batch table). */
export const MASTER_DATA_SYNC_BATCH_SIZE = 100;

export type MasterDataSyncPhase =
  | 'PREPARING'
  | 'REMOVING'
  | 'TESTS'
  | 'PANELS'
  | 'SAVING';

export type MasterDataSyncProgressEvent =
  /** Entered a phase (`REMOVING` carries how many branch tests are removed). */
  | { type: 'phase'; phase: MasterDataSyncPhase; count?: number }
  /** Matching + pre-flight done: how many tenant tests will be processed. */
  | { type: 'tests-planned'; total: number; toUpdate: number; toCreate: number }
  /**
   * Cumulative tenant tests processed (updated or cloned). Emitted after every
   * `MASTER_DATA_SYNC_BATCH_SIZE` tests and once more at the end.
   */
  | { type: 'tests-processed'; processed: number };

export type MasterDataSyncProgressListener = (
  event: MasterDataSyncProgressEvent,
) => Promise<void> | void;

/** Counts returned by the Tenant → Branch Master Data sync. */
export interface MasterDataSyncResult {
  tests: { created: number; updated: number; deleted: number };
  panels: { created: number; updated: number; deleted: number };
}

/** Optional hooks into `LabPanelService.syncTenantToBranch`. */
export interface MasterDataSyncHooks {
  onProgress?: MasterDataSyncProgressListener;
  /**
   * Runs INSIDE the sync transaction after every write, just before commit —
   * anything it writes through `tx` commits (or rolls back) together with the
   * import. A throw rolls the whole import back.
   */
  beforeCommit?: (
    tx: Prisma.TransactionClient,
    result: MasterDataSyncResult,
  ) => Promise<void>;
}
