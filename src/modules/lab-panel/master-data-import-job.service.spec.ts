import { MasterDataImportJobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataImportConflictException } from '../lab-test/exceptions/lab-test.exceptions';
import { MasterDataSyncProgressListener } from '../lab-test/master-data-sync-progress';
import { LabPanelService } from './lab-panel.service';
import {
  MASTER_DATA_IMPORT_STALE_MS,
  MasterDataImportJobService,
  MasterDataImportProgress,
  applyEvent,
  toJobError,
} from './master-data-import-job.service';

const fresh = (): MasterDataImportProgress => ({
  phase: 'PREPARING',
  total: 0,
  processed: 0,
  totalBatches: 0,
  currentBatch: 0,
  batches: [],
  toUpdate: 0,
  toCreate: 0,
  toRemove: 0,
});

describe('applyEvent (import progress)', () => {
  it('splits the planned tests into batches of 100 and walks them', () => {
    const p = fresh();
    applyEvent(p, {
      type: 'tests-planned',
      total: 250,
      toUpdate: 200,
      toCreate: 50,
    });
    expect(p.totalBatches).toBe(3);
    expect(p.batches.map((b) => b.status)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);

    applyEvent(p, { type: 'phase', phase: 'REMOVING', count: 4 });
    expect(p).toMatchObject({ phase: 'REMOVING', toRemove: 4 });

    applyEvent(p, { type: 'phase', phase: 'TESTS' });
    expect(p.currentBatch).toBe(1);
    expect(p.batches[0]!.status).toBe('running');

    applyEvent(p, { type: 'tests-processed', processed: 100 });
    expect(p.batches.map((b) => b.status)).toEqual([
      'completed',
      'running',
      'pending',
    ]);
    expect(p).toMatchObject({ processed: 100, currentBatch: 2 });

    applyEvent(p, { type: 'tests-processed', processed: 250 });
    expect(p.batches.map((b) => [b.status, b.processed])).toEqual([
      ['completed', 100],
      ['completed', 200],
      ['completed', 250],
    ]);
    expect(p.currentBatch).toBe(0);
  });

  it('treats an empty catalogue as one completed batch', () => {
    const p = fresh();
    applyEvent(p, {
      type: 'tests-planned',
      total: 0,
      toUpdate: 0,
      toCreate: 0,
    });
    applyEvent(p, { type: 'phase', phase: 'TESTS' });
    applyEvent(p, { type: 'tests-processed', processed: 0 });
    expect(p.batches).toEqual([
      { batch: 1, processed: 0, status: 'completed' },
    ]);
  });
});

describe('toJobError', () => {
  const midTests = () => {
    const p = fresh();
    applyEvent(p, {
      type: 'tests-planned',
      total: 250,
      toUpdate: 250,
      toCreate: 0,
    });
    applyEvent(p, { type: 'phase', phase: 'TESTS' });
    applyEvent(p, { type: 'tests-processed', processed: 100 });
    return p; // batch 2 of 3 running
  };

  it('keeps a Kaltros error code/message and says nothing was saved', () => {
    const err = toJobError(
      new MasterDataImportConflictException([{ field: 'name', value: 'GGT' }]),
      fresh(),
    );
    expect(err.code).toBe('MASTER_DATA_IMPORT_CONFLICT');
    expect(err.message).toContain('name "GGT"');
    expect(err.message).toContain('No changes were saved.');
    expect(err.phase).toBe('PREPARING');
  });

  it('reports a transaction timeout with the failing batch', () => {
    const err = toJobError(
      new Prisma.PrismaClientKnownRequestError('Transaction already closed', {
        code: 'P2028',
        clientVersion: 'test',
      }),
      midTests(),
    );
    expect(err).toMatchObject({
      code: 'MASTER_DATA_IMPORT_TIMEOUT',
      phase: 'TESTS',
      batch: 2,
    });
    expect(err.message).toContain('at batch 2 of 3');
  });

  it('hides unexpected errors behind a generic message', () => {
    const err = toJobError(new Error('socket hang up'), midTests());
    expect(err.code).toBe('MASTER_DATA_IMPORT_FAILED');
    expect(err.message).not.toContain('socket');
    expect(err.message).toContain('at batch 2 of 3');
  });
});

describe('MasterDataImportJobService', () => {
  const job = (over: Record<string, unknown> = {}) => ({
    id: 'job-1',
    tenantId: 't1',
    branchId: 'b1',
    status: MasterDataImportJobStatus.RUNNING,
    progress: fresh(),
    result: null,
    error: null,
    startedBy: 'p1',
    startedAt: new Date(),
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  let prisma: {
    masterDataImportJob: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    runWithTenant: jest.Mock;
  };
  let sync: jest.Mock;
  let service: MasterDataImportJobService;
  /** `run` is private — exercised directly so the test can await it. */
  let run: (
    jobId: string,
    tenantId: string,
    branchId: string,
    actorId: string | null,
  ) => Promise<void>;

  beforeEach(() => {
    prisma = {
      masterDataImportJob: {
        create: jest.fn().mockResolvedValue(job()),
        update: jest.fn().mockResolvedValue(job()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      runWithTenant: jest.fn((_t: string, work: () => unknown) => work()),
    };
    sync = jest.fn();
    service = new MasterDataImportJobService(
      prisma as unknown as PrismaService,
      { syncTenantToBranch: sync } as unknown as LabPanelService,
    );
    run = (service as unknown as { run: typeof run }).run.bind(service);
  });

  const lastUpdate = () =>
    (
      prisma.masterDataImportJob.update.mock.calls.at(-1) as [
        {
          data: {
            status?: string;
            progress: MasterDataImportProgress;
            result?: unknown;
            error?: { code: string };
          };
        },
      ]
    )[0].data;

  it('start() creates a RUNNING job and returns it without waiting for the sync', async () => {
    sync.mockReturnValue(new Promise(() => undefined)); // never settles
    const view = await service.start('t1', 'b1', 'p1');
    expect(view).toMatchObject({ id: 'job-1', status: 'RUNNING' });
    expect(prisma.masterDataImportJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 't1',
          branchId: 'b1',
          startedBy: 'p1',
        }) as unknown,
      }),
    );
    expect(sync).toHaveBeenCalledWith('t1', 'b1', 'p1', expect.any(Function));
  });

  it.each([
    ['b1', true, 'An import is already running for this branch.'],
    ['b2', false, 'Another branch'],
  ])(
    'start() rejects with 409 while another import runs (running on %s)',
    async (runningBranch, _same, message) => {
      prisma.masterDataImportJob.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      prisma.masterDataImportJob.findFirst.mockResolvedValue({
        id: 'job-0',
        branchId: runningBranch,
      });
      await expect(service.start('t1', 'b1', 'p1')).rejects.toMatchObject({
        status: 409,
        response: {
          error: {
            code: 'MASTER_DATA_IMPORT_ALREADY_RUNNING',
            message: expect.stringContaining(message) as unknown,
          },
        },
      });
      expect(sync).not.toHaveBeenCalled();
    },
  );

  it('run() writes progress per batch and records the result', async () => {
    sync.mockImplementation(
      async (
        _t: string,
        _b: string,
        _a: string,
        onProgress: MasterDataSyncProgressListener,
      ) => {
        await onProgress({
          type: 'tests-planned',
          total: 150,
          toUpdate: 150,
          toCreate: 0,
        });
        await onProgress({ type: 'phase', phase: 'REMOVING', count: 0 });
        await onProgress({ type: 'phase', phase: 'TESTS' });
        await onProgress({ type: 'tests-processed', processed: 100 });
        await onProgress({ type: 'tests-processed', processed: 150 });
        await onProgress({ type: 'phase', phase: 'PANELS' });
        await onProgress({ type: 'phase', phase: 'SAVING' });
        return {
          tests: { created: 0, updated: 150, deleted: 0 },
          panels: { created: 1, updated: 0, deleted: 0 },
        };
      },
    );

    await run('job-1', 't1', 'b1', 'p1');

    // 7 progress writes + the final one, all tenant-scoped (outside the sync tx).
    expect(prisma.masterDataImportJob.update).toHaveBeenCalledTimes(8);
    expect(prisma.runWithTenant).toHaveBeenCalledTimes(8);
    const mid = (
      prisma.masterDataImportJob.update.mock.calls[3] as [
        { data: { progress: MasterDataImportProgress } },
      ]
    )[0].data.progress;
    expect(mid.batches.map((b) => b.status)).toEqual(['completed', 'running']);
    const final = lastUpdate();
    expect(final.status).toBe('SUCCEEDED');
    expect(final.result).toEqual({
      tests: { created: 0, updated: 150, deleted: 0 },
      panels: { created: 1, updated: 0, deleted: 0 },
    });
    expect(final.progress.phase).toBe('DONE');
  });

  it('run() marks a failed import FAILED with the failing batch, earlier ones rolled back', async () => {
    sync.mockImplementation(
      async (
        _t: string,
        _b: string,
        _a: string,
        onProgress: MasterDataSyncProgressListener,
      ) => {
        await onProgress({
          type: 'tests-planned',
          total: 250,
          toUpdate: 250,
          toCreate: 0,
        });
        await onProgress({ type: 'phase', phase: 'TESTS' });
        await onProgress({ type: 'tests-processed', processed: 100 });
        throw new Error('boom');
      },
    );

    await run('job-1', 't1', 'b1', 'p1');

    const final = lastUpdate();
    expect(final.status).toBe('FAILED');
    expect(final.error).toMatchObject({
      code: 'MASTER_DATA_IMPORT_FAILED',
      batch: 2,
    });
    expect(final.progress.batches.map((b) => b.status)).toEqual([
      'rolled_back',
      'failed',
      'pending',
    ]);
    expect(final.progress.phase).toBe('FAILED');
  });

  it('run() keeps going when a progress write fails', async () => {
    prisma.masterDataImportJob.update
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValue(job());
    sync.mockImplementation(
      async (
        _t: string,
        _b: string,
        _a: string,
        onProgress: MasterDataSyncProgressListener,
      ) => {
        await onProgress({ type: 'phase', phase: 'PANELS' });
        return {
          tests: { created: 0, updated: 0, deleted: 0 },
          panels: { created: 0, updated: 0, deleted: 0 },
        };
      },
    );

    await run('job-1', 't1', 'b1', 'p1');

    expect(lastUpdate().status).toBe('SUCCEEDED');
  });

  it('get() reports a RUNNING job with no progress write for too long as INTERRUPTED', async () => {
    const stale = job({
      updatedAt: new Date(Date.now() - MASTER_DATA_IMPORT_STALE_MS - 1000),
    });
    prisma.masterDataImportJob.findFirst.mockResolvedValue(stale);
    prisma.masterDataImportJob.findUnique.mockResolvedValue({
      ...stale,
      status: MasterDataImportJobStatus.INTERRUPTED,
      error: {
        code: 'MASTER_DATA_IMPORT_INTERRUPTED',
        message: 'x',
        phase: 'PREPARING',
      },
    });

    const view = await service.get('job-1', 't1', 'b1');

    expect(prisma.masterDataImportJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1', status: MasterDataImportJobStatus.RUNNING },
      }),
    );
    expect(view.status).toBe('INTERRUPTED');
  });

  it('get() leaves a recently-updated RUNNING job alone', async () => {
    prisma.masterDataImportJob.findFirst.mockResolvedValue(job());
    const view = await service.get('job-1', 't1', 'b1');
    expect(view.status).toBe('RUNNING');
    expect(prisma.masterDataImportJob.updateMany).not.toHaveBeenCalled();
  });

  it('get() 404s for another branch or tenant', async () => {
    prisma.masterDataImportJob.findFirst.mockResolvedValue(null);
    await expect(service.get('job-1', 't1', 'b9')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.masterDataImportJob.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-1', tenantId: 't1', branchId: 'b9' },
    });
  });

  it('on startup, marks jobs left RUNNING by this process slot INTERRUPTED', async () => {
    prisma.masterDataImportJob.findMany.mockResolvedValue([job()]);
    prisma.masterDataImportJob.findUnique.mockResolvedValue(
      job({ status: MasterDataImportJobStatus.INTERRUPTED }),
    );

    await service.onApplicationBootstrap();

    const [[query]] = prisma.masterDataImportJob.findMany.mock.calls as [
      [{ where: { status: string; runner: string } }],
    ];
    expect(query.where.status).toBe('RUNNING');
    expect(query.where.runner).toMatch(/#/);
    const [[update]] = prisma.masterDataImportJob.updateMany.mock.calls as [
      [{ data: { status: string; error: { code: string } } }],
    ];
    expect(update.data.status).toBe('INTERRUPTED');
    expect(update.data.error.code).toBe('MASTER_DATA_IMPORT_INTERRUPTED');
  });

  it('a failing startup sweep never breaks boot', async () => {
    prisma.masterDataImportJob.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('start() records which process slot runs the job', async () => {
    sync.mockReturnValue(new Promise(() => undefined));
    await service.start('t1', 'b1', 'p1');
    const [[arg]] = prisma.masterDataImportJob.create.mock.calls as [
      [{ data: { runner: string } }],
    ];
    expect(arg.data.runner).toMatch(/#/);
  });

  it('getActive() returns null when nothing runs', async () => {
    prisma.masterDataImportJob.findFirst.mockResolvedValue(null);
    await expect(service.getActive('t1', 'b1')).resolves.toBeNull();
  });
});
