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

interface LatestTransfer {
  transferStatus: string;
  kind?: string;
  rejectionReason?: string | null;
  repeatReason?: string | null;
}

interface OpenTransfer {
  id: string;
  destinationBranchId: string | null;
  transferStatus: string;
  logisticsType: string | null;
}

interface Opts {
  /** The sample's OPEN INTERNAL transfers (what a Retrieve takes back); default: one in transit. */
  open?: OpenTransfer[];
  /** The sample's latest INTERNAL transfer (what the receiving branch did with it). */
  latest?: LatestTransfer;
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
    // names for the audit text of a recall
    branch: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'A', name: 'Branch A' },
        { id: 'B', name: 'Branch B' },
      ]),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
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
      // Two reads share this mock: the OPEN transfers a Retrieve takes back (asks for
      // In-Transit / Picked Up), and the newest INTERNAL transfer (`findReceiverReturns`).
      findMany: jest.fn(
        (args: { where?: { transferStatus?: { in?: string[] } } }) => {
          if (args?.where?.transferStatus?.in) {
            // (a sample that is not Sent has no open INTERNAL transfer: a Forwarded /
            // Outsourced one is unwound by the recall instead)
            return Promise.resolve(
              opts.open ??
                (sample.status === SampleStatus.SENT_INTERNAL
                  ? [
                      {
                        id: 'tr1',
                        destinationBranchId: 'B',
                        transferStatus: 'IN_TRANSIT',
                        logisticsType: 'Courier',
                      },
                    ]
                  : []),
            );
          }
          return Promise.resolve(
            opts.latest
              ? [
                  {
                    sampleId: 's1',
                    kind: 'INTERNAL',
                    rejectionReason: null,
                    repeatReason: null,
                    ...opts.latest,
                  },
                ]
              : [],
          );
        },
      ),
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
    action: 'retrieve' | 'repeat' | 'error',
    note: {
      force?: boolean;
      system?: boolean;
      notes?: string;
      actor?: { roleKey: string | null; roleLabel: string | null };
    } = {},
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

  it('SOFT-DELETES the OPEN transfer (the row leaves the receiving branch) and does not run the recall', async () => {
    const m = build();
    await m.run('retrieve');
    expect(m.recall).not.toHaveBeenCalled();
    const call = m.tx.sampleTransfer.updateMany.mock.calls[0]![0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(call.data).toMatchObject({
      rejectionReason: 'Recalled via Retrieve',
      updatedBy: 'p1',
    });
    // it is no longer written as a REJECTED row the receiving branch could still see
    expect(call.data).not.toHaveProperty('transferStatus');
    // only the transfers that were open (In-Transit / Picked Up), none already deleted
    expect(call.where).toMatchObject({ id: { in: ['tr1'] }, deletedAt: null });
    // and only an INTERNAL transfer that the receiving branch has not received yet
    const read = m.tx.sampleTransfer.findMany.mock.calls
      .map((c) => c[0] as { where: Record<string, unknown> })
      .find(
        (c) => (c.where.transferStatus as { in?: string[] } | undefined)?.in,
      )!;
    expect(read.where).toMatchObject({
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

describe('the sender after the receiving branch sent the sample back (Sent – Repeated / Sent – Rejected)', () => {
  const repeated = { transferStatus: 'REPEAT', repeatReason: 'clotted' };
  const rejected = { transferStatus: 'REJECTED', rejectionReason: 'hemolysed' };

  it('Sent – Repeated: the sender may Repeat; the sample leaves Sent for Repeat', async () => {
    const m = build({}, { latest: repeated });
    await m.run('repeat');
    expect(m.updatedData()).toMatchObject({
      status: SampleStatus.REPEAT,
      previousStatus: SampleStatus.SENT_INTERNAL,
      // back at its origin: processing branch and dispatch fields reset
      processingBranchId: 'A',
      dispatchedAt: null,
    });
  });

  it('Sent – Rejected: the sender may flag Error; the sample leaves Sent for Error', async () => {
    const m = build({}, { latest: rejected });
    await m.run('error');
    expect(m.updatedData()).toMatchObject({
      status: SampleStatus.ERROR,
      previousStatus: SampleStatus.SENT_INTERNAL,
      processingBranchId: 'A',
    });
  });

  it.each([
    ['Repeat', 'repeat', repeated],
    ['Error', 'error', rejected],
  ] as const)(
    "the sender's %s is NOT a recall: the receiving branch's closed transfer is kept for both branches",
    async (_label, action, latest) => {
      const m = build({}, { latest });
      await m.run(action);
      expect(m.recall).not.toHaveBeenCalled();
      expect(m.tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    },
  );

  it('the Repeat does not reset the report again (it was reset when the receiving branch acted)', async () => {
    const m = build({}, { latest: repeated });
    await m.run('repeat');
    expect(
      m.labReportService.findReportIdsForSampleTests,
    ).not.toHaveBeenCalled();
    expect(m.labReportService.resetReportsForReturn).not.toHaveBeenCalled();
  });

  it.each([
    ['Repeat after a REJECTION', 'repeat', rejected],
    ['Error after a REPEAT request', 'error', repeated],
    [
      'Repeat while still IN_TRANSIT',
      'repeat',
      { transferStatus: 'IN_TRANSIT' },
    ],
    ['Error while RECEIVED', 'error', { transferStatus: 'RECEIVED' }],
    ['Repeat while ACCEPTED', 'repeat', { transferStatus: 'ACCEPTED' }],
    [
      'Error after the SYSTEM closed it (Recalled via Retrieve)',
      'error',
      { transferStatus: 'REJECTED', rejectionReason: 'Recalled via Retrieve' },
    ],
    [
      'Error after the SYSTEM closed it (Order item removed)',
      'error',
      { transferStatus: 'REJECTED', rejectionReason: 'Order item removed' },
    ],
    [
      'Repeat after an EXTERNAL transfer closed as REPEAT',
      'repeat',
      { transferStatus: 'REPEAT', kind: 'EXTERNAL' },
    ],
  ] as const)(
    '%s is refused, even when forced, and writes nothing',
    async (_label, action, latest) => {
      const m = build({}, { latest });
      await expect(m.run(action, { force: true })).rejects.toBeInstanceOf(
        SampleSentToBranchException,
      );
      expect(m.recall).not.toHaveBeenCalled();
      expect(m.tx.orderSample.updateMany).not.toHaveBeenCalled();
      expect(m.tx.orderSample.update).not.toHaveBeenCalled();
    },
  );

  it('every other action stays refused on a sent-back sample (Hold, Store, Return, ...)', async () => {
    const m = build({}, { latest: repeated });
    const run = m.run as (a: string, n?: object) => Promise<unknown>;
    for (const action of ['hold', 'store', 'return', 'send', 'cancel']) {
      await expect(run(action)).rejects.toBeInstanceOf(
        SampleSentToBranchException,
      );
    }
    expect(m.tx.orderSample.update).not.toHaveBeenCalled();
  });

  it.each([
    ['Sent – Repeated', repeated],
    ['Sent – Rejected', rejected],
  ])(
    'Retrieve is refused on %s: it would only put the tube back to Accepted as if nothing had happened',
    async (_label, latest) => {
      const m = build({}, { latest });
      await expect(m.run('retrieve')).rejects.toBeInstanceOf(
        RetrieveBlockedException,
      );
      expect(m.tx.orderSample.update).not.toHaveBeenCalled();
      expect(m.tx.orderSample.updateMany).not.toHaveBeenCalled();
      expect(m.tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
      expect(m.recall).not.toHaveBeenCalled();
    },
  );

  it('Retrieve of a Sent sample whose transfer is NOT a send-back (still open, or closed by the system) is unchanged', async () => {
    const m = build({}, { latest: { transferStatus: 'IN_TRANSIT' } });
    await m.run('retrieve');
    expect(m.updatedData()).toMatchObject({
      status: SampleStatus.ACCEPTED,
      processingBranchId: 'A',
    });
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

  // The receiving branch returned the sample (Sent → Repeat) and the sender collected
  // it again: stepping back must never land on "Sent" with no open transfer.
  it.each([
    SampleStatus.SENT_INTERNAL,
    SampleStatus.FORWARD_EXTERNAL,
    SampleStatus.OUTSOURCED,
  ])(
    'never walks back into %s: it stops with "nothing to retrieve" and changes nothing',
    async (transferred) => {
      const m = build(
        { status: SampleStatus.REPEAT, previousStatus: SampleStatus.COLLECTED },
        { history: { fromStatus: transferred } },
      );
      // the same "nothing to retrieve" refusal the immediate-Repeat case gives
      await expect(m.run('retrieve')).rejects.toBeInstanceOf(
        RetrieveBlockedException,
      );
      expect(m.tx.orderSample.update).not.toHaveBeenCalled();
      expect(m.tx.orderSample.updateMany).not.toHaveBeenCalled();
      expect(m.recall).not.toHaveBeenCalled();
    },
  );

  it('still walks back normally past a returned cycle (Collected goes back to Repeat, Repeat to Accepted when the sender repeated it)', async () => {
    const collected = build(
      { status: SampleStatus.COLLECTED, previousStatus: SampleStatus.REPEAT },
      { history: { fromStatus: SampleStatus.REPEAT } },
    );
    await collected.run('retrieve');
    expect(collected.updatedData().status).toBe(SampleStatus.REPEAT);

    const repeated = build(
      { status: SampleStatus.REPEAT, previousStatus: SampleStatus.ACCEPTED },
      { history: { fromStatus: SampleStatus.ACCEPTED } },
    );
    await repeated.run('retrieve');
    expect(repeated.updatedData().status).toBe(SampleStatus.ACCEPTED);
  });
});

describe('a Retrieve that takes a sample back from another branch writes the audit trail (in the same transaction)', () => {
  const actor = {
    roleKey: 'accession_manager',
    roleLabel: 'Accession Manager',
  };
  const open = (over: Partial<OpenTransfer> = {}): OpenTransfer => ({
    id: 'tr1',
    destinationBranchId: 'B',
    transferStatus: 'IN_TRANSIT',
    logisticsType: 'Courier',
    ...over,
  });
  const entries = (m: ReturnType<typeof build>) =>
    (
      m.tx.auditLog.create.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >
    ).map((c) => c[0].data);
  const historyNote = (m: ReturnType<typeof build>) =>
    (
      (
        m.tx.orderSampleStatusHistory.create.mock.calls as unknown[][]
      )[0]![0] as {
        data: { notes: string | null };
      }
    ).data.notes;

  it('one entry under the SENDER branch and one under the RECEIVING branch, with the details, who and the role', async () => {
    const m = build({ accessionNo: 'ACC-7' }, { open: [open()] });
    await m.run('retrieve', { actor });
    const e = entries(m);
    expect(e).toHaveLength(2);
    expect(e.map((x) => x.branchId)).toEqual(['A', 'B']);
    for (const x of e) {
      expect(x).toMatchObject({
        tenantId: 't1',
        module: 'ACCESSION',
        action: 'UPDATE',
        actorPersonId: 'p1',
        actorRoleKey: 'accession_manager',
        actorRoleLabel: 'Accession Manager',
        resourceId: 's1',
      });
      expect(x.metadata).toMatchObject({
        sampleId: 's1',
        accessionNo: 'ACC-7',
        transferId: 'tr1',
        stage: 'In-Transit',
        fromBranch: 'Branch A',
        toBranch: 'Branch B',
      });
    }
    expect(e[0]!.description).toBe(
      'Retrieved sample ACC-7 from Branch B while In-Transit',
    );
    expect(e[1]!.description).toContain(
      'retrieved by Branch A before Branch B received it',
    );
  });

  it("the sender's history row says where it was retrieved from and at which stage (Picked Up too)", async () => {
    const m = build({}, { open: [open({ transferStatus: 'PICKED_UP' })] });
    await m.run('retrieve', { notes: 'sent by mistake' });
    expect(historyNote(m)).toBe(
      'sent by mistake · Retrieved from Branch B while Picked Up',
    );
  });

  it('no center assigned yet: only the sender is told (there is no receiving branch)', async () => {
    const m = build(
      {},
      { open: [open({ destinationBranchId: null, logisticsType: null })] },
    );
    await m.run('retrieve', { actor });
    const e = entries(m);
    expect(e.map((x) => x.branchId)).toEqual(['A']);
    expect(e[0]!.description).toContain('no center assigned yet');
  });

  it('In-Transit with no logistics type (hidden from the receiving branch): only the sender is told', async () => {
    const m = build({}, { open: [open({ logisticsType: null })] });
    await m.run('retrieve', { actor });
    expect(entries(m).map((x) => x.branchId)).toEqual(['A']);
  });

  it('Picked Up with no logistics (older data) is visible to the receiving branch, so it is told too', async () => {
    const m = build(
      {},
      { open: [open({ transferStatus: 'PICKED_UP', logisticsType: null })] },
    );
    await m.run('retrieve', { actor });
    expect(entries(m).map((x) => x.branchId)).toEqual(['A', 'B']);
  });

  it('nothing was recalled (no open transfer): no soft delete and no audit entry', async () => {
    const m = build({}, { open: [] });
    await m.run('retrieve', { actor });
    expect(entries(m)).toHaveLength(0);
    expect(m.tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    expect(historyNote(m)).toBeNull();
  });

  it('a Repeat / Error the sender does after a send-back is not a recall: no audit entry', async () => {
    const m = build(
      {},
      { latest: { transferStatus: 'REPEAT', repeatReason: 'x' } },
    );
    await m.run('repeat');
    expect(entries(m)).toHaveLength(0);
  });
});
