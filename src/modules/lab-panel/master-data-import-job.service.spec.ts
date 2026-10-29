import { MasterDataImportJobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataImportConflictException } from '../lab-test/exceptions/lab-test.exceptions';
import {
  MasterDataSyncHooks,
  MasterDataSyncProgressEvent,
} from '../lab-test/master-data-sync-progress';
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

  it('reports "could not start a transaction" (pool busy) as DB busy, not a 5-minute timeout', () => {
    const err = toJobError(
      new Prisma.PrismaClientKnownRequestError(
        'Transaction API error: Unable to start a transaction in the given time.',
        { code: 'P2028', clientVersion: 'test' },
      ),
      fresh(),
    );
    expect(err.code).toBe('MASTER_DATA_IMPORT_DB_BUSY');
    expect(err.message).not.toContain('took longer than');
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
  let tx: { masterDataImportJob: { update: jest.Mock } };
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
    tx = { masterDataImportJob: { update: jest.fn().mockResolvedValue({}) } };
    service = new MasterDataImportJobService(
      prisma as unknown as PrismaService,
      { syncTenantToBranch: sync } as unknown as LabPanelService,
    );
    run = (service as unknown as { run: typeof run }).run.bind(service);
  });

  type Data = {
    status?: string;
    progress: MasterDataImportProgress;
    result?: unknown;
    error?: { code: string; batch?: number };
  };
  type Where = { id: string; status?: string };
  /** Outside-the-transaction writes (progress + failure), in order. */
  const outsideWrites = () =>
    (
      prisma.masterDataImportJob.updateMany.mock.calls as [
        { where: Where; data: Data },
      ][]
    ).map(([x]) => x);
  const result = {
    tests: { created: 0, updated: 150, deleted: 0 },
    panels: { created: 1, updated: 0, deleted: 0 },
  };
  /** A sync double that emits `events`, then commits via `beforeCommit` (unless `fail`). */
  const fakeSync =
    (
      events: MasterDataSyncProgressEvent[],
      fail?: { at: 'before' | 'after'; error: unknown },
    ) =>
    async (_t: string, _b: string, _a: string, hooks: MasterDataSyncHooks) => {
      for (const e of events) await hooks.onProgress?.(e);
      if (fail?.at === 'before') throw fail.error;
      await hooks.beforeCommit?.(
        tx as unknown as Prisma.TransactionClient,
        result,
      );
      if (fail?.at === 'after') throw fail.error; // commit ok, but its ack lost
      return result;
    };
  const planned150: MasterDataSyncProgressEvent[] = [
    { type: 'tests-planned', total: 150, toUpdate: 150, toCreate: 0 },
    { type: 'phase', phase: 'REMOVING', count: 0 },
    { type: 'phase', phase: 'TESTS' },
    { type: 'tests-processed', processed: 100 },
    { type: 'tests-processed', processed: 150 },
    { type: 'phase', phase: 'PANELS' },
    { type: 'phase', phase: 'SAVING' },
  ];

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
    expect(sync).toHaveBeenCalledWith('t1', 'b1', 'p1', {
      onProgress: expect.any(Function) as unknown,
      beforeCommit: expect.any(Function) as unknown,
    });
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

  it('run() writes SUCCEEDED + result INSIDE the sync transaction', async () => {
    sync.mockImplementation(fakeSync(planned150));

    await run('job-1', 't1', 'b1', 'p1');

    const [[final]] = tx.masterDataImportJob.update.mock.calls as [
      [{ where: Where; data: Data }],
    ];
    expect(final.where).toEqual({ id: 'job-1' });
    expect(final.data.status).toBe('SUCCEEDED');
    expect(final.data.result).toEqual(result);
    expect(final.data.progress.phase).toBe('DONE');
    expect(final.data.progress.batches.map((b) => b.status)).toEqual([
      'completed',
      'completed',
    ]);
    // Nothing outside the transaction claims the outcome.
    expect(outsideWrites().some((w) => w.data.status)).toBe(false);
  });

  it('run() progress writes are tenant-scoped, ordered, and only apply while RUNNING', async () => {
    sync.mockImplementation(fakeSync(planned150));

    await run('job-1', 't1', 'b1', 'p1');

    const writes = outsideWrites();
    expect(writes).toHaveLength(planned150.length);
    expect(prisma.runWithTenant).toHaveBeenCalledTimes(planned150.length);
    for (const w of writes)
      expect(w.where).toEqual({ id: 'job-1', status: 'RUNNING' });
    expect(writes[3]!.data.progress.batches.map((b) => b.status)).toEqual([
      'completed',
      'running',
    ]);
    expect(writes.at(-1)!.data.progress.phase).toBe('SAVING');
  });

  it('run() never makes the sync wait for a progress write', async () => {
    let release!: () => void;
    prisma.masterDataImportJob.updateMany.mockImplementationOnce(
      () => new Promise((res) => (release = () => res({ count: 1 }))),
    );
    sync.mockImplementation(fakeSync(planned150));

    const done = run('job-1', 't1', 'b1', 'p1');
    // The sync got all the way to its commit while the first write still hangs.
    await new Promise((r) => setImmediate(r));
    expect(tx.masterDataImportJob.update).toHaveBeenCalled();
    release();
    await done;
  });

  it('run() marks a failed import FAILED (only if still RUNNING), failing batch + rolled-back ones', async () => {
    sync.mockImplementation(
      fakeSync(
        [
          { type: 'tests-planned', total: 250, toUpdate: 250, toCreate: 0 },
          { type: 'phase', phase: 'TESTS' },
          { type: 'tests-processed', processed: 100 },
        ],
        { at: 'before', error: new Error('boom') },
      ),
    );

    await run('job-1', 't1', 'b1', 'p1');

    expect(tx.masterDataImportJob.update).not.toHaveBeenCalled();
    const final = outsideWrites().at(-1)!;
    expect(final.where).toEqual({ id: 'job-1', status: 'RUNNING' });
    expect(final.data.status).toBe('FAILED');
    expect(final.data.error).toMatchObject({
      code: 'MASTER_DATA_IMPORT_FAILED',
      batch: 2,
    });
    expect(final.data.progress.batches.map((b) => b.status)).toEqual([
      'rolled_back',
      'failed',
      'pending',
    ]);
    expect(final.data.progress.phase).toBe('FAILED');
  });

  it('run(): if the commit succeeded but its acknowledgement was lost, the FAILED write cannot overwrite SUCCEEDED', async () => {
    sync.mockImplementation(
      fakeSync(planned150, {
        at: 'after',
        error: new Error('connection reset'),
      }),
    );
    // Once the in-transaction SUCCEEDED write committed, the row is no longer RUNNING.
    prisma.masterDataImportJob.updateMany.mockImplementation(
      ({ where, data }: { where: Where; data: Data }) =>
        Promise.resolve({
          count: where.status === 'RUNNING' && data.status ? 0 : 1,
        }),
    );

    await run('job-1', 't1', 'b1', 'p1');

    expect(tx.masterDataImportJob.update).toHaveBeenCalled();
    const failed = outsideWrites().find((w) => w.data.status === 'FAILED')!;
    expect(failed.where.status).toBe('RUNNING'); // conditional → no-op on the SUCCEEDED row
  });

  it('run() keeps going when a progress write fails', async () => {
    prisma.masterDataImportJob.updateMany
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValue({ count: 1 });
    sync.mockImplementation(fakeSync(planned150));

    await run('job-1', 't1', 'b1', 'p1');

    expect(tx.masterDataImportJob.update).toHaveBeenCalled();
    expect(outsideWrites()).toHaveLength(planned150.length);
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
    // host # pm2 app name # pm2 instance
    expect(arg.data.runner.split('#')).toHaveLength(3);
  });

  it('getActive() returns null when nothing runs', async () => {
    prisma.masterDataImportJob.findFirst.mockResolvedValue(null);
    await expect(service.getActive('t1', 'b1')).resolves.toBeNull();
  });
});
