import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import {
  InvalidSampleTransitionException,
  SampleRetrieveBlockedByResultException,
  refusalMessage,
} from './exceptions/accession.exceptions';

/**
 * Retrieve (the universal undo) in the NORMAL flow: it may not pull a sample that
 * is at this branch back to BEFORE its acceptance while a test on it already has
 * a validated result (Result Done, Approved, Published). Everything else about
 * Retrieve is unchanged: an undo that stays at / after acceptance, a sample that
 * is out at another branch (its own transfer rules), a result that is not
 * validated yet (stays saved), a sample with no report.
 */

interface Opts {
  /** the status the sample's own history says it came from (the Retrieve target) */
  from?: SampleStatus | null;
  /** the reports the sample serves */
  reportIds?: string[];
  /** a report has a validated result */
  validated?: boolean;
  tests?: { orderItemId: string; labTestId: string | null }[];
}

function build(sampleOver: Record<string, unknown> = {}, opts: Opts = {}) {
  const sample = {
    id: 's1',
    tenantId: 't1',
    branchId: 'A',
    originBranchId: 'A',
    processingBranchId: 'A',
    orderId: 'o1',
    status: SampleStatus.ACCEPTED,
    previousStatus: SampleStatus.COLLECTED,
    sourceTransferId: null,
    deletedAt: null,
    ...sampleOver,
  };
  const tests = opts.tests ?? [{ orderItemId: 'oi1', labTestId: 'lt1' }];
  const tx = {
    order: { findFirst: jest.fn().mockResolvedValue(null) },
    orderSample: {
      findFirst: jest.fn().mockResolvedValue(sample),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest
        .fn<Promise<unknown>, [{ data: Record<string, unknown> }]>()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...sample, ...data }),
        ),
    },
    orderSampleTest: { findMany: jest.fn().mockResolvedValue(tests) },
    orderSampleStatusHistory: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.from === undefined
            ? { fromStatus: SampleStatus.COLLECTED }
            : opts.from === null
              ? null
              : { fromStatus: opts.from },
        ),
      create: jest.fn().mockResolvedValue({}),
    },
    sampleTransfer: {
      // "did the receiving branch send it back?" probe of Retrieve: it did not
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const lab = {
    findReportIdsForSampleTests: jest
      .fn()
      .mockResolvedValue(opts.reportIds ?? ['r1']),
    lockReports: jest.fn().mockResolvedValue(undefined),
    canReturnToSender: jest.fn().mockResolvedValue(!opts.validated),
    resetReportsForReturn: jest.fn().mockResolvedValue(undefined),
  };
  const service = new OrderSampleService(
    {} as never,
    {} as never,
    lab as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest
    .spyOn(
      service as unknown as {
        recallTransfersForSampleInTx: (...a: unknown[]) => Promise<void>;
      },
      'recallTransfersForSampleInTx',
    )
    .mockResolvedValue(undefined);
  const run = (note: { system?: boolean } = {}) =>
    service.transitionInTx(
      tx as never,
      't1',
      'p1',
      's1',
      'retrieve',
      () => ({ data: {} }),
      note,
    );
  const updatedData = () => tx.orderSample.update.mock.calls[0]![0].data;
  /** nothing about the sample or its transfers was written */
  const nothingWritten = () => {
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(tx.orderSample.updateMany).not.toHaveBeenCalled();
    expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
  };
  return { run, tx, lab, updatedData, nothingWritten, service };
}

const BEFORE_ACCEPTANCE = [
  SampleStatus.NEW,
  SampleStatus.COLLECTED,
  SampleStatus.ACQUIRED,
  SampleStatus.HALT,
  SampleStatus.ERROR,
  SampleStatus.HOLD,
  SampleStatus.REPEAT,
];

describe('Retrieve - a validated result stops an undo back to before acceptance', () => {
  it.each(BEFORE_ACCEPTANCE)(
    'refused when the undo would land on %s',
    async (target) => {
      const m = build({}, { from: target, validated: true });
      await expect(m.run()).rejects.toBeInstanceOf(
        SampleRetrieveBlockedByResultException,
      );
      m.nothingWritten();
    },
  );

  it('the refusal is a skippable 422 with its own code and points to Re-run', async () => {
    const m = build({}, { validated: true });
    const e = await m.run().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(InvalidSampleTransitionException);
    const err = e as SampleRetrieveBlockedByResultException;
    expect(err.getStatus()).toBe(422);
    expect(err.errorCode).toBe('SAMPLE_RETRIEVE_BLOCKED_RESULT_DONE');
    // the sentence lives in the response body (`e.message` is only the class name)
    expect(refusalMessage(err)).toContain('Re-run');
    expect(err.message).not.toContain('Re-run');
  });

  it('the reports are locked BEFORE the check, so a validation in flight cannot slip in', async () => {
    const m = build({}, { validated: true });
    await m.run().catch(() => undefined);
    const lock = m.lab.lockReports.mock.invocationCallOrder[0]!;
    const check = m.lab.canReturnToSender.mock.invocationCallOrder[0]!;
    expect(lock).toBeLessThan(check);
  });

  it("looks up the reports of THIS sample's tests, at the branch holding it", async () => {
    const tests = [
      { orderItemId: 'oi1', labTestId: 'lt1' },
      { orderItemId: 'oi2', labTestId: null },
    ];
    const m = build({ branchId: 'A' }, { tests, validated: true });
    await m.run().catch(() => undefined);
    expect(m.lab.findReportIdsForSampleTests).toHaveBeenCalledWith(
      m.tx,
      't1',
      'A',
      tests,
    );
  });

  it('every report of the sample is checked together (one validated test among several is enough)', async () => {
    const m = build({}, { reportIds: ['r1', 'r2', 'r3'], validated: true });
    await expect(m.run()).rejects.toBeInstanceOf(
      SampleRetrieveBlockedByResultException,
    );
    expect(m.lab.lockReports).toHaveBeenCalledWith(m.tx, 't1', [
      'r1',
      'r2',
      'r3',
    ]);
    expect(m.lab.canReturnToSender).toHaveBeenCalledWith(m.tx, 't1', [
      'r1',
      'r2',
      'r3',
    ]);
  });
});

describe('Retrieve - everything that is not a validated result still works as before', () => {
  it('no validated result: Accepted goes back to Collected, nothing deleted', async () => {
    const m = build({}, { validated: false });
    await m.run();
    expect(m.updatedData().status).toBe(SampleStatus.COLLECTED);
    expect(m.lab.canReturnToSender).toHaveBeenCalledTimes(1);
    // the rule only looks: no report is reset or changed by a Retrieve
    expect(m.lab.resetReportsForReturn).not.toHaveBeenCalled();
  });

  it('a sample with no report at all can be retrieved', async () => {
    const m = build({}, { reportIds: [], validated: false });
    await expect(m.run()).resolves.toBeDefined();
    expect(m.updatedData().status).toBe(SampleStatus.COLLECTED);
  });

  it('an undo that does not go back before acceptance is not consulted (Stored -> Accepted)', async () => {
    const m = build(
      { status: SampleStatus.STORED },
      { from: SampleStatus.ACCEPTED, validated: true },
    );
    await m.run();
    expect(m.updatedData().status).toBe(SampleStatus.ACCEPTED);
    expect(m.lab.canReturnToSender).not.toHaveBeenCalled();
    expect(m.lab.lockReports).not.toHaveBeenCalled();
  });

  it('Halted -> Accepted is not consulted either', async () => {
    const m = build(
      { status: SampleStatus.HALT },
      { from: SampleStatus.ACCEPTED, validated: true },
    );
    await m.run();
    expect(m.updatedData().status).toBe(SampleStatus.ACCEPTED);
    expect(m.lab.canReturnToSender).not.toHaveBeenCalled();
  });

  it('Discarded -> Stored is not consulted either', async () => {
    const m = build(
      { status: SampleStatus.DISCARDED },
      { from: SampleStatus.STORED, validated: true },
    );
    await m.run();
    expect(m.updatedData().status).toBe(SampleStatus.STORED);
    expect(m.lab.canReturnToSender).not.toHaveBeenCalled();
  });

  it.each([
    SampleStatus.SENT_INTERNAL,
    SampleStatus.FORWARD_EXTERNAL,
    SampleStatus.OUTSOURCED,
  ])(
    'a sample that is out (%s) keeps its own transfer rules: the report check is not applied',
    async (status) => {
      const m = build(
        { status, previousStatus: SampleStatus.COLLECTED },
        { validated: true },
      );
      await m.run();
      expect(m.lab.canReturnToSender).not.toHaveBeenCalled();
      expect(m.lab.lockReports).not.toHaveBeenCalled();
      expect(m.updatedData().status).toBe(SampleStatus.COLLECTED);
    },
  );

  it('a system-driven move is not subject to it', async () => {
    const m = build({}, { validated: true });
    await expect(m.run({ system: true })).resolves.toBeDefined();
    expect(m.lab.canReturnToSender).not.toHaveBeenCalled();
  });

  it('with no previous status to go back to it is an ordinary invalid transition, and no report is looked at', async () => {
    const m = build({}, { from: null, validated: true });
    const e = await m.run().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(InvalidSampleTransitionException);
    expect(e).not.toBeInstanceOf(SampleRetrieveBlockedByResultException);
    expect(m.lab.lockReports).not.toHaveBeenCalled();
    m.nothingWritten();
  });
});

describe('Retrieve in a group action', () => {
  function group() {
    const tx = {
      orderSample: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'good', accessionNo: 'ACC-1', status: SampleStatus.ACCEPTED },
          { id: 'done', accessionNo: 'ACC-2', status: SampleStatus.ACCEPTED },
        ]),
      },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const service = new OrderSampleService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const internals = service as unknown as {
      transitionInTx: jest.Mock;
      findById: jest.Mock;
      ensureLabReportsForAcceptedSample: jest.Mock;
      transitionIds: (
        ids: string[],
        tenantId: string,
        personId: string | null,
        action: string,
        build: () => unknown,
        note: Record<string, unknown>,
      ) => Promise<{
        succeeded: unknown[];
        skipped: {
          id: string;
          accessionNo: string | null;
          reason: string;
          code?: string;
        }[];
      }>;
    };
    internals.transitionInTx = jest
      .fn()
      .mockImplementation((_tx: unknown, _t: string, _p: string, id: string) =>
        id === 'done'
          ? Promise.reject(
              new SampleRetrieveBlockedByResultException(SampleStatus.ACCEPTED),
            )
          : Promise.resolve({ id, status: SampleStatus.COLLECTED }),
      );
    internals.findById = jest
      .fn()
      .mockImplementation((id: string) => Promise.resolve({ id }));
    internals.ensureLabReportsForAcceptedSample = jest
      .fn()
      .mockResolvedValue(undefined);
    return internals;
  }

  it('with "skip invalid" the sample with a validated result is skipped, named, with the real reason; the rest is retrieved', async () => {
    const svc = group();
    const r = await svc.transitionIds(
      ['good', 'done'],
      't1',
      'p1',
      'retrieve',
      () => ({ data: {} }),
      { skipInvalid: true },
    );
    expect(r.succeeded).toEqual([{ id: 'good' }]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({ id: 'done', accessionNo: 'ACC-2' });
    expect(r.skipped[0]!.reason).toContain('Re-run');
    // the machine-readable reason: the strict call's own code
    expect(r.skipped[0]!.code).toBe('SAMPLE_RETRIEVE_BLOCKED_RESULT_DONE');
    expect(r.skipped[0]!.reason).not.toContain('is not allowed from status');
  });

  it('other refusals keep the generic skipped reason', async () => {
    const svc = group();
    svc.transitionInTx.mockImplementation(
      (_tx: unknown, _t: string, _p: string, id: string) =>
        id === 'done'
          ? Promise.reject(
              new InvalidSampleTransitionException(
                'retrieve',
                SampleStatus.ACCEPTED,
              ),
            )
          : Promise.resolve({ id, status: SampleStatus.COLLECTED }),
    );
    const r = await svc.transitionIds(
      ['good', 'done'],
      't1',
      'p1',
      'retrieve',
      () => ({ data: {} }),
      { skipInvalid: true },
    );
    expect(r.skipped[0]!.reason).toBe(
      'Action "retrieve" is not allowed from status ACCEPTED',
    );
    expect(r.skipped[0]!.code).toBe('INVALID_SAMPLE_TRANSITION');
  });

  it('without "skip invalid" the refusal stops the whole group', async () => {
    const svc = group();
    await expect(
      svc.transitionIds(
        ['good', 'done'],
        't1',
        'p1',
        'retrieve',
        () => ({ data: {} }),
        {},
      ),
    ).rejects.toBeInstanceOf(SampleRetrieveBlockedByResultException);
  });
});
