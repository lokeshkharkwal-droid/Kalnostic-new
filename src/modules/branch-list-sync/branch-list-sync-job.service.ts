import { hostname } from 'node:os';
import {
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  BranchListSyncJob,
  BranchListSyncKind,
  MasterDataImportJobStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchLabTestService } from '../branch-lab-test/branch-lab-test.service';
import { BranchLabPanelService } from '../branch-lab-panel/branch-lab-panel.service';
import { MasterDataSyncProgressListener } from '../lab-test/master-data-sync-progress';
import {
  MasterDataImportError,
  MasterDataImportPhase,
  MasterDataImportProgress,
  MASTER_DATA_IMPORT_STALE_MS,
  applyEvent,
} from '../lab-panel/master-data-import-job.service';
import {
  BranchListSyncAlreadyRunningException,
  BranchListSyncJobNotFoundException,
} from './exceptions/branch-list-sync.exceptions';

/**
 * Counts of a completed "Sync from Master Data" reconcile for one branch list.
 * `failed` = items of a batch that failed and was skipped so the rest of the sync
 * could continue (partial-failure tolerant).
 */
export interface BranchListSyncResult {
  created: number;
  updated: number;
  deleted: number;
  failed: number;
}

/** What the API returns for a sync job. */
export interface BranchListSyncJobView {
  id: string;
  branchId: string;
  kind: BranchListSyncKind;
  status: MasterDataImportJobStatus;
  progress: MasterDataImportProgress;
  result: BranchListSyncResult | null;
  error: MasterDataImportError | null;
  startedAt: Date;
  finishedAt: Date | null;
  updatedAt: Date;
}

/**
 * This backend process's slot — host + pm2 app name + pm2 instance — stored on
 * its jobs so it can mark its own leftover RUNNING jobs INTERRUPTED on startup
 * without touching another app's (mirrors MasterDataImportJobService).
 */
const RUNNER = `${hostname()}#${process.env.name ?? 'node'}#${process.env.NODE_APP_INSTANCE ?? '0'}`;

/**
 * Runs "Sync from Master Data" (reconcile a branch's Lab Test / Lab Panel List
 * against its Branch Master Data — add/update/delete) as a background job so the
 * branch-admin dialog can poll live progress instead of holding one long HTTP
 * request open (nginx cuts those at 120s). Mirrors
 * {@link MasterDataImportJobService}, one service for both list kinds (`kind`),
 * reusing its progress model + `applyEvent` fold.
 *
 * Unlike the Import Master Data job, the reconcile is NON-ATOMIC: it commits in
 * fixed batches and a failing batch is counted and skipped (see
 * `BranchLabTestService.syncFromMasterData`). The job therefore records SUCCEEDED
 * + result AFTER the reconcile returns (no in-transaction `beforeCommit`).
 *
 * Syncs of one kind run one at a time per branch (partial unique index on
 * RUNNING) to keep database load bounded.
 */
@Injectable()
export class BranchListSyncJobService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BranchListSyncJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly branchLabTestService: BranchLabTestService,
    private readonly branchLabPanelService: BranchLabPanelService,
  ) {}

  /**
   * Start a sync for the branch's list of `kind` and return immediately; the
   * reconcile runs in the background. 409 `BRANCH_LIST_SYNC_ALREADY_RUNNING` if one
   * of the same kind is already running for this branch (attach via `getActive`).
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT)
   * @param actorId person id recorded as created/updated-by (or null)
   * @param kind which branch list to reconcile (lab tests vs lab panels)
   * @param listId optional target pricing list (omit = the branch's Walk-in list)
   */
  async start(
    tenantId: string,
    branchId: string,
    actorId: string | null,
    kind: BranchListSyncKind,
    listId?: string,
  ): Promise<BranchListSyncJobView> {
    await this.expireStale(tenantId, branchId, kind);
    let job: BranchListSyncJob;
    try {
      job = await this.prisma.branchListSyncJob.create({
        data: {
          tenantId,
          branchId,
          kind,
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
        const running = await this.prisma.branchListSyncJob.findFirst({
          where: {
            tenantId,
            branchId,
            kind,
            status: MasterDataImportJobStatus.RUNNING,
          },
          select: { id: true },
        });
        throw new BranchListSyncAlreadyRunningException(
          running?.id ?? '',
          branchId,
          kind,
        );
      }
      throw e;
    }
    // Detached on purpose: the request returns 202 now; the run reports its own
    // outcome on the job row and never rejects.
    void this.run(job.id, tenantId, branchId, actorId, kind, listId);
    return toView(job);
  }

  /**
   * A job still RUNNING under this process slot was started by its previous
   * incarnation, which is gone (restart/crash) — report it INTERRUPTED now.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const orphaned = await this.prisma.branchListSyncJob.findMany({
        where: { status: MasterDataImportJobStatus.RUNNING, runner: RUNNER },
      });
      for (const job of orphaned) await this.interrupt(job);
      if (orphaned.length) {
        this.logger.warn(
          `Marked ${orphaned.length} sync job(s) left RUNNING by a previous process INTERRUPTED`,
        );
      }
    } catch (e) {
      this.logger.error(`Could not sweep leftover sync jobs: ${String(e)}`);
    }
  }

  /** One job of this branch (404 if it isn't this tenant's + branch's). */
  async get(
    jobId: string,
    tenantId: string,
    branchId: string,
  ): Promise<BranchListSyncJobView> {
    const job = await this.prisma.branchListSyncJob.findFirst({
      where: { id: jobId, tenantId, branchId },
    });
    if (!job) throw new BranchListSyncJobNotFoundException(jobId);
    return toView(await this.interruptIfStale(job));
  }

  /** The branch's running sync of `kind`, if any — lets a reopened page re-attach. */
  async getActive(
    tenantId: string,
    branchId: string,
    kind: BranchListSyncKind,
  ): Promise<BranchListSyncJobView | null> {
    const job = await this.prisma.branchListSyncJob.findFirst({
      where: {
        tenantId,
        branchId,
        kind,
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
   * The background run: drives the reconcile and records its progress/outcome.
   * Progress writes go through their own short tenant-scoped transactions and are
   * serialised; SUCCEEDED/FAILED are written only while the job is still RUNNING
   * (a late write can't overwrite the final state).
   */
  private async run(
    jobId: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
    kind: BranchListSyncKind,
    listId?: string,
  ): Promise<void> {
    const progress = initialProgress();
    let writes: Promise<void> = Promise.resolve();
    const saveProgress = () => {
      const snapshot = structuredClone(progress);
      writes = writes.then(() =>
        this.prisma
          .runWithTenant(tenantId, () =>
            this.prisma.branchListSyncJob.updateMany({
              where: { id: jobId, status: MasterDataImportJobStatus.RUNNING },
              data: { progress: snapshot as unknown as Prisma.InputJsonValue },
            }),
          )
          .then(
            () => undefined,
            (e: unknown) =>
              this.logger.warn(
                `Sync job ${jobId}: progress write failed: ${String(e)}`,
              ),
          ),
      );
    };
    const onProgress: MasterDataSyncProgressListener = (event) => {
      applyEvent(progress, event);
      saveProgress();
    };

    try {
      const result =
        kind === BranchListSyncKind.LAB_TEST
          ? await this.branchLabTestService.syncFromMasterData(
              tenantId,
              branchId,
              actorId,
              { listId },
              onProgress,
            )
          : await this.branchLabPanelService.syncFromMasterData(
              tenantId,
              branchId,
              actorId,
              { listId },
              onProgress,
            );
      progress.phase = 'DONE';
      progress.currentBatch = 0;
      await writes;
      await this.prisma.runWithTenant(tenantId, () =>
        this.prisma.branchListSyncJob.updateMany({
          where: { id: jobId, status: MasterDataImportJobStatus.RUNNING },
          data: {
            status: MasterDataImportJobStatus.SUCCEEDED,
            result: result as unknown as Prisma.InputJsonValue,
            progress: structuredClone(
              progress,
            ) as unknown as Prisma.InputJsonValue,
            finishedAt: new Date(),
          },
        }),
      );
    } catch (e) {
      const error = toSyncError(e, progress);
      markFailed(progress);
      this.logger.error(
        `Sync job ${jobId} (branch ${branchId}, ${kind}) failed in ${error.phase}: ${error.code}`,
        e instanceof Error ? e.stack : String(e),
      );
      await writes;
      await this.prisma
        .runWithTenant(tenantId, () =>
          this.prisma.branchListSyncJob.updateMany({
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
            `Sync job ${jobId}: could not record failure: ${String(writeErr)}`,
          ),
        );
    } finally {
      await writes;
    }
  }

  /** Mark this branch+kind's dead RUNNING rows INTERRUPTED (frees the one-running slot). */
  private async expireStale(
    tenantId: string,
    branchId: string,
    kind: BranchListSyncKind,
  ): Promise<void> {
    const stale = await this.prisma.branchListSyncJob.findMany({
      where: {
        tenantId,
        branchId,
        kind,
        status: MasterDataImportJobStatus.RUNNING,
        updatedAt: { lt: new Date(Date.now() - MASTER_DATA_IMPORT_STALE_MS) },
      },
    });
    for (const job of stale) await this.interruptIfStale(job);
  }

  private async interruptIfStale(
    job: BranchListSyncJob,
  ): Promise<BranchListSyncJob> {
    if (
      job.status !== MasterDataImportJobStatus.RUNNING ||
      Date.now() - job.updatedAt.getTime() <= MASTER_DATA_IMPORT_STALE_MS
    ) {
      return job;
    }
    return this.interrupt(job);
  }

  /** Record a dead RUNNING job as INTERRUPTED. */
  private async interrupt(job: BranchListSyncJob): Promise<BranchListSyncJob> {
    const progress = job.progress as unknown as MasterDataImportProgress;
    const error: MasterDataImportError = {
      code: 'BRANCH_LIST_SYNC_INTERRUPTED',
      message:
        'The sync was interrupted (the server restarted). Please run it again.',
      phase: progress.phase,
    };
    markFailed(progress);
    await this.prisma.branchListSyncJob.updateMany({
      where: { id: job.id, status: MasterDataImportJobStatus.RUNNING },
      data: {
        status: MasterDataImportJobStatus.INTERRUPTED,
        progress: progress as unknown as Prisma.InputJsonValue,
        error: error as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    return (
      (await this.prisma.branchListSyncJob.findUnique({
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

/**
 * On failure the batch in flight is `failed` and already-processed batches stay
 * `completed` — unlike the atomic import, the reconcile commits per batch, so
 * processed batches are NOT rolled back.
 */
function markFailed(progress: MasterDataImportProgress): void {
  for (const b of progress.batches) {
    if (b.status === 'running') b.status = 'failed';
  }
  progress.phase = 'FAILED';
  progress.currentBatch = 0;
}

/** Map a reconcile failure to a user-facing `{ code, message, phase }`. */
function toSyncError(
  e: unknown,
  progress: MasterDataImportProgress,
): MasterDataImportError {
  const phase: MasterDataImportPhase = progress.phase;
  if (e instanceof HttpException) {
    const body = e.getResponse() as {
      error?: { code?: string; message?: string };
    };
    return {
      phase,
      code: body.error?.code ?? 'BRANCH_LIST_SYNC_FAILED',
      message: body.error?.message ?? 'The sync failed.',
    };
  }
  return {
    phase,
    code: 'BRANCH_LIST_SYNC_FAILED',
    message: 'The sync stopped because of an unexpected error.',
  };
}

function toView(job: BranchListSyncJob): BranchListSyncJobView {
  return {
    id: job.id,
    branchId: job.branchId,
    kind: job.kind,
    status: job.status,
    progress: job.progress as unknown as MasterDataImportProgress,
    result: (job.result as unknown as BranchListSyncResult | null) ?? null,
    error: (job.error as unknown as MasterDataImportError | null) ?? null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
  };
}
