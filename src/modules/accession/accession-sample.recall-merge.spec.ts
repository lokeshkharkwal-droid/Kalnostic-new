import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import {
  InvalidSampleTransitionException,
  RetrieveBlockedException,
  SampleSentToBranchException,
} from './exceptions/accession.exceptions';

/**
 * Retrieve / Repeat / recall of a sample that is out at another branch or partner.
 * Two designs meet here and both must keep working:
 *  - the sender's Retrieve closes only the OPEN transfers as REJECTED
 *    ("Recalled via Retrieve") and is refused once the receiving branch has
 *    received them; a sample the receiver sent back cannot be retrieved;
 *  - the destructive recall (`recallTransfersForSampleInTx`) belongs to the
 *    sender's own Retrieve / Repeat of a Forwarded / Outsourced sample ONLY (a
 *    partner / outsource centre has no branch design: main's cleanup stays). It must never
 *    run for the system moves a receiving branch's Reject / Repeat / Return
 *    triggers: those close the transfer themselves right after, and a recall in
 *    between would soft-delete the very transfer being acted on.
 * A normal (not transferred) sample is retrieved to the status its own history
 * says it came from.
 */
interface TransferUpdate {
  where: { sampleId: string; deletedAt: null } & Record<string, unknown>;
  data: Record<string, unknown>;
}

interface Opts {
  progressed?: boolean;
  history?: { fromStatus: SampleStatus } | null;
  claimCount?: number;
}

function build(sampleOver: Record<string, unknown> = {}, opts: Opts = {}) {
  const sample = {
    id: 's1',
    tenantId: 't1',
    branchId: 'A',
    originBranchId: 'A',
    processingBranchId: 'B',
    orderId: 'o1',
    status: SampleStatus.SENT_INTERNAL,
    previousStatus: SampleStatus.ACCEPTED,
    sourceTransferId: null,
    deletedAt: null,
    ...sampleOver,
  };
  const tx = {
    order: { findFirst: jest.fn().mockResolvedValue(null) },
    orderSample: {
      findFirst: jest.fn().mockResolvedValue(sample),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
      update: jest
        .fn<Promise<unknown>, [{ data: Record<string, unknown> }]>()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...sample, ...data }),
        ),
    },
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
    orderSampleStatusHistory: {
      findFirst: jest
        .fn<Promise<unknown>, [{ where: Record<string, unknown> }]>()
        .mockResolvedValue(opts.history ?? null),
      create: jest.fn().mockResolvedValue({}),
    },
    sampleTransfer: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.progressed ? { id: 'tr1' } : null),
      updateMany: jest
        .fn<Promise<{ count: number }>, [TransferUpdate]>()
        .mockResolvedValue({ count: 1 }),
    },
  };
  const labReportService = {
    findReportIdsForSampleTests: jest.fn().mockResolvedValue([]),
    lockReports: jest.fn().mockResolvedValue(undefined),
    canReturnToSender: jest.fn().mockResolvedValue(true),
    resetReportsForReturn: jest.fn().mockResolvedValue(undefined),
  };
  const service = new OrderSampleService(
    {} as never,
    {} as never,
    labReportService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const recall = jest
    .spyOn(
      service as unknown as {
        recallTransfersForSampleInTx: (...a: unknown[]) => Promise<void>;
      },
      'recallTransfersForSampleInTx',
    )
    .mockResolvedValue(undefined);
  const run = (
    action: 'retrieve' | 'repeat',
    note: { force?: boolean; system?: boolean; notes?: string } = {},
  ) =>
    service.transitionInTx(
      tx as never,
      't1',
      'p1',
      's1',
      action,
      () => ({ data: {} }),
      note,
    );
  const updatedData = () => tx.orderSample.update.mock.calls[0]![0].data;
  return { run, tx, recall, updatedData, labReportService };
}

describe('a receiving branch’s system-driven return does not run the recall', () => {
  it('SENT_INTERNAL → REPEAT (system) leaves the transfer for the transfer service to close', async () => {
    const m = build();
    await m.run('repeat', { force: true, system: true, notes: 'returned' });
    expect(m.recall).not.toHaveBeenCalled();
    expect(m.tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    expect(m.updatedData().status).toBe(SampleStatus.REPEAT);
  });

  it('but the sample is back at its origin: the processing branch and dispatch fields are reset', async () => {
    const m = build();
    await m.run('repeat', { force: true, system: true });
    expect(m.updatedData()).toMatchObject({
      processingBranchId: 'A',
      dispatchedAt: null,
      logisticsType: null,
      logisticsPerson: null,
    });
  });
});

describe('the sender’s own Repeat of a Forwarded / Outsourced sample', () => {
  it('unwinds its transfer (the recall runs once)', async () => {
    const m = build({ status: SampleStatus.FORWARD_EXTERNAL });
    await m.run('repeat', { force: true });
    expect(m.recall).toHaveBeenCalledTimes(1);
    expect(m.recall).toHaveBeenCalledWith(
      m.tx,
      't1',
      'p1',
      expect.objectContaining({ id: 's1' }),
    );
    expect(m.updatedData().status).toBe(SampleStatus.REPEAT);
  });

  it('claims the row first: a concurrent action that already moved it stops the recall', async () => {
    const m = build(
      { status: SampleStatus.FORWARD_EXTERNAL },
      { claimCount: 0 },
    );
    await expect(m.run('repeat', { force: true })).rejects.toBeInstanceOf(
      InvalidSampleTransitionException,
    );
    expect(m.recall).not.toHaveBeenCalled();
    expect(m.tx.orderSample.update).not.toHaveBeenCalled();
  });
});

describe('Retrieve of a sample sent to another branch', () => {
  it('goes back to the status it had before it was sent', async () => {
    const m = build({ previousStatus: SampleStatus.COLLECTED });
    await m.run('retrieve');
    expect(m.updatedData().status).toBe(SampleStatus.COLLECTED);
  });

  it('closes the OPEN transfers as REJECTED "Recalled via Retrieve" and does not run the recall', async () => {
    const m = build();
    await m.run('retrieve');
    expect(m.recall).not.toHaveBeenCalled();
    const call = m.tx.sampleTransfer.updateMany.mock.calls[0]![0];
    expect(call.data).toMatchObject({
      transferStatus: 'REJECTED',
      rejectionReason: 'Recalled via Retrieve',
      updatedBy: 'p1',
    });
    // never an earlier cycle's finished transfer, never a deleted one, and only
    // an INTERNAL transfer that the receiving branch has not received yet
    expect(call.where).toMatchObject({
      sampleId: 's1',
      deletedAt: null,
      kind: 'INTERNAL',
      transferStatus: { in: ['IN_TRANSIT', 'PICKED_UP'] },
    });
  });

  it('puts the sample back at its origin (processing branch and dispatch fields reset)', async () => {
    const m = build();
    await m.run('retrieve');
    expect(m.updatedData()).toMatchObject({
      processingBranchId: 'A',
      dispatchedAt: null,
    });
  });

  it('is refused once the receiving branch has received it, and nothing is written', async () => {
    const m = build({}, { progressed: true });
    await expect(m.run('retrieve')).rejects.toBeInstanceOf(
      RetrieveBlockedException,
    );
    expect(m.tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    expect(m.tx.orderSample.updateMany).not.toHaveBeenCalled();
    expect(m.tx.orderSample.update).not.toHaveBeenCalled();
    expect(m.recall).not.toHaveBeenCalled();
  });

  it('is refused when the receiving branch has already sent the sample back', async () => {
    const m = build({
      status: SampleStatus.REPEAT,
      previousStatus: SampleStatus.SENT_INTERNAL,
    });
    await expect(m.run('retrieve')).rejects.toBeInstanceOf(
      RetrieveBlockedException,
    );
    expect(m.tx.orderSample.update).not.toHaveBeenCalled();
  });
});

describe('Retrieve of a Forwarded / Outsourced sample (a partner, not a branch)', () => {
  it.each([SampleStatus.FORWARD_EXTERNAL, SampleStatus.OUTSOURCED])(
    'runs the recall cleanup (a partner has no branch design) and never closes the transfer as REJECTED (%s)',
    async (status) => {
      const m = build({ status, previousStatus: SampleStatus.ACCEPTED });
      await m.run('retrieve');
      expect(m.recall).toHaveBeenCalledTimes(1);
      expect(m.recall).toHaveBeenCalledWith(
        m.tx,
        't1',
        'p1',
        expect.objectContaining({ id: 's1' }),
      );
      // The only transfer write Retrieve makes is scoped to INTERNAL transfers, so
      // it cannot touch the external / outsource transfer the recall just unwound.
      for (const [arg] of m.tx.sampleTransfer.updateMany.mock.calls) {
        expect(arg.where).toMatchObject({ kind: 'INTERNAL' });
      }
      expect(m.updatedData()).toMatchObject({
        status: SampleStatus.ACCEPTED,
        processingBranchId: 'A',
        dispatchedAt: null,
        logisticsType: null,
        logisticsPerson: null,
      });
    },
  );
});

describe('the sender cannot Repeat a Sent sample', () => {
  it('refuses a user Repeat of a SENT_INTERNAL sample, even when forced, and writes nothing', async () => {
    const m = build();
    await expect(m.run('repeat', { force: true })).rejects.toBeInstanceOf(
      SampleSentToBranchException,
    );
    expect(m.recall).not.toHaveBeenCalled();
    expect(m.tx.orderSample.updateMany).not.toHaveBeenCalled();
    expect(m.tx.orderSample.update).not.toHaveBeenCalled();
  });
});

describe('Retrieve of a sample that is not transferred', () => {
  it('walks back its own history: the status it moved FROM into the current one', async () => {
    const m = build(
      { status: SampleStatus.ACCEPTED, previousStatus: SampleStatus.NEW },
      { history: { fromStatus: SampleStatus.COLLECTED } },
    );
    await m.run('retrieve');
    expect(m.updatedData().status).toBe(SampleStatus.COLLECTED);
    const where =
      m.tx.orderSampleStatusHistory.findFirst.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      sampleId: 's1',
      toStatus: SampleStatus.ACCEPTED,
      fromStatus: { not: SampleStatus.ACCEPTED },
      action: { not: 'retrieve' },
    });
  });

  it('runs no recall and does not move the processing branch', async () => {
    const m = build(
      { status: SampleStatus.ACCEPTED },
      { history: { fromStatus: SampleStatus.COLLECTED } },
    );
    await m.run('retrieve');
    expect(m.recall).not.toHaveBeenCalled();
    expect(m.updatedData()).not.toHaveProperty('processingBranchId');
  });

  it('with no history it falls back to the transition table (Returned goes back to Accepted)', async () => {
    const m = build(
      { status: SampleStatus.RETURNED, previousStatus: SampleStatus.ACCEPTED },
      { history: null },
    );
    await m.run('retrieve');
    expect(m.updatedData().status).toBe(SampleStatus.ACCEPTED);
  });
});
