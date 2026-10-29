import { hostname } from 'node:os';
import {
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  MasterDataImportJob,
  MasterDataImportJobStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MASTER_DATA_SYNC_BATCH_SIZE,
  MasterDataSyncProgressEvent,
} from '../lab-test/master-data-sync-progress';
import {
  LabPanelService,
  MASTER_DATA_SYNC_TX_TIMEOUT_MS,
} from './lab-panel.service';
import {
  MasterDataImportAlreadyRunningException,
  MasterDataImportJobNotFoundException,
} from './exceptions/lab-panel.exceptions';

/** Where the run is (the dialog's headline). */
export type MasterDataImportPhase =
  | 'PREPARING'
  | 'REMOVING'
  | 'TESTS'
  | 'PANELS'
  | 'SAVING'
  | 'DONE'
  | 'FAILED';

/**
 * Per-batch row of the dialog's batch table. `rolled_back` = the batch had been
 * processed, but a later failure rolled the whole (atomic) import back.
 */
export interface MasterDataImportBatch {
  batch: number;
  /** Cumulative tenant tests processed once this batch completed. */
  processed: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'rolled_back';
}

/** Live progress stored on the job row (`progress` JSON). */
export interface MasterDataImportProgress {
  phase: MasterDataImportPhase;
  /** Tenant tests to process (each is updated or cloned into the branch). */
  total: number;
  processed: number;
  totalBatches: number;
  /** 1-based batch in flight (0 before the first). */
  currentBatch: number;
  batches: MasterDataImportBatch[];
  toUpdate: number;
  toCreate: number;
  /** Branch tests removed because their tenant source is gone. */
  toRemove: number;
}

export interface MasterDataImportResult {
  tests: { created: number; updated: number; deleted: number };
  panels: { created: number; updated: number; deleted: number };
}

export interface MasterDataImportError {
  code: string;
  message: string;
  /** Phase the run was in when it stopped. */
  phase: MasterDataImportPhase;
  /** Batch that failed (when it stopped while processing tests). */
  batch?: number;
}

/** What the API returns for a job. */
export interface MasterDataImportJobView {
  id: string;
  branchId: string;
  status: MasterDataImportJobStatus;
  progress: MasterDataImportProgress;
  result: MasterDataImportResult | null;
  error: MasterDataImportError | null;
  startedAt: Date;
  finishedAt: Date | null;
  updatedAt: Date;
}

/**
 * A RUNNING job is written to after every batch and the sync can't outlive its
 * transaction timeout (+ the 30s connection wait), so a RUNNING row untouched
 * for longer than this is no longer running anywhere (process restarted).
 */
export const MASTER_DATA_IMPORT_STALE_MS =
  MASTER_DATA_SYNC_TX_TIMEOUT_MS + 60_000;

const NO_CHANGES = 'No changes were saved.';

/**
 * This backend process's slot — host + pm2 app name + pm2 instance — stored
 * on its jobs. The app name keeps another app on the same host (e.g. the
 * `kalnostics-dev` pm2 app, same .env) from sweeping this app's jobs.
 */
const RUNNER = `${hostname()}#${process.env.name ?? 'node'}#${process.env.NODE_APP_INSTANCE ?? '0'}`;

/**
 * Runs "Import Master Data" (Tenant → Branch Master Data) as a background job so
 * the branch-admin dialog can poll live progress instead of holding one long
 * HTTP request open (nginx cuts those at 120s).
 *
 * The sync itself is unchanged and still ONE atomic transaction
 * (`LabPanelService.syncTenantToBranch`): the 100-test batches are progress
 * steps, not commit points — any failure rolls the whole import back. Progress
 * is written to the job row from OUTSIDE that transaction (its own short,
 * tenant-scoped write), so pollers see it while the import is still running.
 *
 * Imports run one at a time per tenant (partial unique index on RUNNING) to
 * keep database load bounded.
 */
@Injectable()
export class MasterDataImportJobService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MasterDataImportJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly labPanelService: LabPanelService,
  ) {}

  /**
   * Start an import for the branch and return immediately; the sync runs in the
   * background. 409 `MASTER_DATA_IMPORT_ALREADY_RUNNING` if one is already
   * running for this tenant (the caller can attach via `getActive`).
   */
  async start(
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<MasterDataImportJobView> {
    await this.expireStale(tenantId);
    let job: MasterDataImportJob;
    try {
      job = await this.prisma.masterDataImportJob.create({
        data: {
          tenantId,
          branchId,
          startedBy: actorId,
          runner: RUNNER,
          progress: initialProgress() as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const running = await this.prisma.masterDataImportJob.findFirst({
          where: { tenantId, status: MasterDataImportJobStatus.RUNNING },
          select: { id: true, branchId: true },
        });
        throw new MasterDataImportAlreadyRunningException(
          running?.id ?? '',
          running?.branchId ?? '',
          running?.branchId === branchId,
        );
      }
      throw e;
    }
    // Detached on purpose: the request returns 202 now; the run reports its
    // own outcome on the job row and never rejects.
    void this.run(job.id, tenantId, branchId, actorId);
    return toView(job);
  }

  /**
   * A job still RUNNING under this process slot was started by its previous
   * incarnation, which is gone (restart/crash) — its transaction rolled back,
   * so report it INTERRUPTED now instead of after the stale window. Jobs of
   * other hosts/instances are left to the stale check.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const orphaned = await this.prisma.masterDataImportJob.findMany({
        where: { status: MasterDataImportJobStatus.RUNNING, runner: RUNNER },
      });
      for (const job of orphaned) await this.interrupt(job);
      if (orphaned.length) {
        this.logger.warn(
          `Marked ${orphaned.length} import job(s) left RUNNING by a previous process INTERRUPTED`,
        );
      }
    } catch (e) {
      this.logger.error(`Could not sweep leftover import jobs: ${String(e)}`);
    }
  }

  /** One job of this branch (404 if it isn't this tenant's + branch's). */
  async get(
    jobId: string,
    tenantId: string,
    branchId: string,
  ): Promise<MasterDataImportJobView> {
    const job = await this.prisma.masterDataImportJob.findFirst({
      where: { id: jobId, tenantId, branchId },
    });
    if (!job) throw new MasterDataImportJobNotFoundException(jobId);
    return toView(await this.interruptIfStale(job));
  }

  /** The branch's running import, if any — lets a reopened page re-attach. */
  async getActive(
    tenantId: string,
    branchId: string,
  ): Promise<MasterDataImportJobView | null> {
    const job = await this.prisma.masterDataImportJob.findFirst({
      where: {
        tenantId,
        branchId,
        status: MasterDataImportJobStatus.RUNNING,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!job) return null;
    const current = await this.interruptIfStale(job);
    return current.status === MasterDataImportJobStatus.RUNNING
      ? toView(current)
      : null;
  }

  /**
   * The background run: drives the sync and records its progress/outcome.
   *
   * - SUCCEEDED + result are written INSIDE the sync transaction
   *   (`beforeCommit`), so the job can never claim success for a rolled-back
   *   import, nor report "nothing saved" for one that committed.
   * - Progress writes go through their own short tenant-scoped transactions
   *   and are NOT awaited by the sync (a busy pool can't slow the import);
   *   they apply only while the job is still RUNNING, so a late one can't
   *   overwrite the final state.
   * - FAILED is likewise written only if the job is still RUNNING (e.g. the
   *   commit succeeded but its acknowledgement was lost → stays SUCCEEDED).
   */
  private async run(
    jobId: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ): Promise<void> {
    const progress = initialProgress();
    // Progress writes are serialised so they land in order.
    let writes: Promise<void> = Promise.resolve();
    const saveProgress = () => {
      const snapshot = structuredClone(progress);
      writes = writes.then(() =>
        this.prisma
          .runWithTenant(tenantId, () =>
            this.prisma.masterDataImportJob.updateMany({
              where: { id: jobId, status: MasterDataImportJobStatus.RUNNING },
              data: { progress: snapshot as unknown as Prisma.InputJsonValue },
            }),
          )
          .then(
            () => undefined,
            (e: unknown) =>
              this.logger.warn(
                `Import job ${jobId}: progress write failed: ${String(e)}`,
              ),
          ),
      );
    };

    try {
      await this.labPanelService.syncTenantToBranch(
        tenantId,
        branchId,
        actorId,
        {
          onProgress: (event) => {
            applyEvent(progress, event);
            saveProgress();
          },
          beforeCommit: async (tx, result) => {
            progress.phase = 'DONE';
            progress.currentBatch = 0;
            await tx.masterDataImportJob.update({
              where: { id: jobId },
              data: {
                status: MasterDataImportJobStatus.SUCCEEDED,
                result: result as unknown as Prisma.InputJsonValue,
                progress: structuredClone(
                  progress,
                ) as unknown as Prisma.InputJsonValue,
                finishedAt: new Date(),
              },
            });
          },
        },
      );
    } catch (e) {
      const error = toJobError(e, progress);
      markFailed(progress);
      this.logger.error(
        `Import job ${jobId} (branch ${branchId}) failed in ${error.phase}: ${error.code}`,
        e instanceof Error ? e.stack : String(e),
      );
      await writes;
      await this.prisma
        .runWithTenant(tenantId, () =>
          this.prisma.masterDataImportJob.updateMany({
            where: { id: jobId, status: MasterDataImportJobStatus.RUNNING },
            data: {
              status: MasterDataImportJobStatus.FAILED,
              error: error as unknown as Prisma.InputJsonValue,
              progress: progress as unknown as Prisma.InputJsonValue,
              finishedAt: new Date(),
            },
          }),
        )
        .catch((writeErr: unknown) =>
          this.logger.error(
            `Import job ${jobId}: could not record failure: ${String(writeErr)}`,
          ),
        );
    } finally {
      await writes;
    }
  }

  /** Mark this tenant's dead RUNNING rows INTERRUPTED (frees the one-running slot). */
  private async expireStale(tenantId: string): Promise<void> {
    const stale = await this.prisma.masterDataImportJob.findMany({
      where: {
        tenantId,
        status: MasterDataImportJobStatus.RUNNING,
        updatedAt: { lt: new Date(Date.now() - MASTER_DATA_IMPORT_STALE_MS) },
      },
    });
    for (const job of stale) await this.interruptIfStale(job);
  }

  private async interruptIfStale(
    job: MasterDataImportJob,
  ): Promise<MasterDataImportJob> {
    if (
      job.status !== MasterDataImportJobStatus.RUNNING ||
      Date.now() - job.updatedAt.getTime() <= MASTER_DATA_IMPORT_STALE_MS
    ) {
      return job;
    }
    return this.interrupt(job);
  }

  /** Record a dead RUNNING job as INTERRUPTED (its transaction rolled back). */
  private async interrupt(
    job: MasterDataImportJob,
  ): Promise<MasterDataImportJob> {
    const progress = job.progress as unknown as MasterDataImportProgress;
    const error: MasterDataImportError = {
      code: 'MASTER_DATA_IMPORT_INTERRUPTED',
      message: `The import was interrupted (the server restarted). ${NO_CHANGES} Please run it again.`,
      phase: progress.phase,
    };
    markFailed(progress);
    // Conditional on still RUNNING so a run that just finished isn't overwritten.
    await this.prisma.masterDataImportJob.updateMany({
      where: { id: job.id, status: MasterDataImportJobStatus.RUNNING },
      data: {
        status: MasterDataImportJobStatus.INTERRUPTED,
        progress: progress as unknown as Prisma.InputJsonValue,
        error: error as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    return (
      (await this.prisma.masterDataImportJob.findUnique({
        where: { id: job.id },
      })) ?? job
    );
  }
}

function initialProgress(): MasterDataImportProgress {
  return {
    phase: 'PREPARING',
    total: 0,
    processed: 0,
    totalBatches: 0,
    currentBatch: 0,
    batches: [],
    toUpdate: 0,
    toCreate: 0,
    toRemove: 0,
  };
}

/** Fold one sync event into the progress snapshot. Exported for tests. */
export function applyEvent(
  progress: MasterDataImportProgress,
  event: MasterDataSyncProgressEvent,
): void {
  switch (event.type) {
    case 'tests-planned': {
      progress.total = event.total;
      progress.toUpdate = event.toUpdate;
      progress.toCreate = event.toCreate;
      progress.totalBatches = Math.max(
        1,
        Math.ceil(event.total / MASTER_DATA_SYNC_BATCH_SIZE),
      );
      progress.batches = Array.from(
        { length: progress.totalBatches },
        (_, i) => ({ batch: i + 1, processed: 0, status: 'pending' as const }),
      );
      return;
    }
    case 'phase': {
      progress.phase = event.phase;
      if (event.phase === 'REMOVING') progress.toRemove = event.count ?? 0;
      if (event.phase === 'TESTS' && progress.batches.length) {
        progress.currentBatch = 1;
        progress.batches[0]!.status = 'running';
      }
      if (event.phase === 'PANELS' || event.phase === 'SAVING') {
        progress.currentBatch = 0;
      }
      return;
    }
    case 'tests-processed': {
      progress.processed = event.processed;
      const done =
        event.processed >= progress.total
          ? progress.totalBatches
          : Math.floor(event.processed / MASTER_DATA_SYNC_BATCH_SIZE);
      for (const b of progress.batches) {
        if (b.batch <= done) {
          b.status = 'completed';
          b.processed = Math.min(
            b.batch * MASTER_DATA_SYNC_BATCH_SIZE,
            progress.total,
          );
        }
      }
      if (done < progress.totalBatches) {
        progress.currentBatch = done + 1;
        progress.batches[done]!.status = 'running';
      } else {
        progress.currentBatch = 0;
      }
      return;
    }
  }
}

/**
 * The import is atomic: on failure the batch in flight is `failed` and every
 * batch already processed is `rolled_back` (nothing was committed).
 */
function markFailed(progress: MasterDataImportProgress): void {
  for (const b of progress.batches) {
    if (b.status === 'running') b.status = 'failed';
    else if (b.status === 'completed') b.status = 'rolled_back';
  }
  progress.phase = 'FAILED';
  progress.currentBatch = 0;
}

/** Map a sync failure to a user-facing `{ code, message }`. Exported for tests. */
export function toJobError(
  e: unknown,
  progress: MasterDataImportProgress,
): MasterDataImportError {
  const phase = progress.phase;
  const running = progress.batches.find((b) => b.status === 'running');
  const at =
    phase === 'TESTS' && running
      ? `at batch ${running.batch} of ${progress.totalBatches}`
      : `while ${PHASE_LABEL[phase]}`;
  const base = {
    phase,
    ...(running && phase === 'TESTS' && { batch: running.batch }),
  };

  if (e instanceof HttpException) {
    const body = e.getResponse() as {
      error?: { code?: string; message?: string };
    };
    return {
      ...base,
      code: body.error?.code ?? 'MASTER_DATA_IMPORT_FAILED',
      message: `${body.error?.message ?? 'The import failed.'} ${NO_CHANGES}`,
    };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    // P2028 covers both "couldn't START a transaction within maxWait" (pool
    // busy) and "transaction timed out / already closed".
    if (
      e.code === 'P2028' &&
      /unable to start a transaction/i.test(e.message)
    ) {
      return {
        ...base,
        code: 'MASTER_DATA_IMPORT_DB_BUSY',
        message: `The database was too busy to run the import. ${NO_CHANGES} Please try again in a few minutes.`,
      };
    }
    if (e.code === 'P2028') {
      return {
        ...base,
        code: 'MASTER_DATA_IMPORT_TIMEOUT',
        message: `The import took longer than ${MASTER_DATA_SYNC_TX_TIMEOUT_MS / 60_000} minutes and was stopped ${at}. ${NO_CHANGES}`,
      };
    }
    if (e.code === 'P2024') {
      return {
        ...base,
        code: 'MASTER_DATA_IMPORT_DB_BUSY',
        message: `The database was too busy to run the import. ${NO_CHANGES} Please try again in a few minutes.`,
      };
    }
  }
  return {
    ...base,
    code: 'MASTER_DATA_IMPORT_FAILED',
    message: `The import stopped ${at} because of an unexpected error. ${NO_CHANGES}`,
  };
}

const PHASE_LABEL: Record<MasterDataImportPhase, string> = {
  PREPARING: 'preparing',
  REMOVING: 'removing old tests',
  TESTS: 'importing tests',
  PANELS: 'importing panels',
  SAVING: 'saving',
  DONE: 'finishing',
  FAILED: 'finishing',
};

function toView(job: MasterDataImportJob): MasterDataImportJobView {
  return {
    id: job.id,
    branchId: job.branchId,
    status: job.status,
    progress: job.progress as unknown as MasterDataImportProgress,
    result: (job.result as unknown as MasterDataImportResult | null) ?? null,
    error: (job.error as unknown as MasterDataImportError | null) ?? null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
  };
}
