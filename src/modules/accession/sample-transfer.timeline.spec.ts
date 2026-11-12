import { SampleStatus, TransferKind, TransferStatus } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import { OrderSampleNotFoundException } from './exceptions/accession.exceptions';

/**
 * Internal Referral timeline. (1) The receiving branch's Pick Up / Receive of an INTERNAL transfer leaves
 * a row on the sender's sample - who, when, at which branch - because the transfer itself keeps only the
 * time. (2) `findTransferTimeline` merges the sender's story, those steps and the receiver's copy.
 */

describe('Pick Up / Receive leave a step row on the sender sample', () => {
  function setup(kind: TransferKind, status: TransferStatus) {
    const create = jest
      .fn<Promise<unknown>, [{ data: Record<string, unknown> }]>()
      .mockResolvedValue({});
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      sampleTransfer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 't1',
          sampleId: 's1',
          kind,
          transferStatus: status,
          destinationBranchId: 'B',
          logisticsType: 'Courier',
          clonedSampleId: null,
          outsourceCenterId: 'oc1',
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderSample: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({
          orderId: 'o1',
          status: SampleStatus.SENT_INTERNAL,
        }),
      },
      orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
      orderSampleStatusHistory: { create },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
      sampleTransfer: { findFirst: jest.fn().mockResolvedValue({ id: 't1' }) },
      orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const samples = { isOrderCancelled: jest.fn().mockResolvedValue(false) };
    const svc = new SampleTransferService(
      prisma as never,
      samples as never,
      {} as never,
      {} as never,
    );
    return { svc, create };
  }

  it('Pick Up writes a transfer-pickup row: acting branch, sender sample, actor, who carried it', async () => {
    const { svc, create } = setup(
      TransferKind.INTERNAL,
      TransferStatus.IN_TRANSIT,
    );
    await svc.pickUp(['t1'], 'tenant', 'person-1', 'B', { pickedUpBy: 'Ravi' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data).toMatchObject({
      tenantId: 'tenant',
      branchId: 'B',
      sampleId: 's1',
      action: 'transfer-pickup',
      changedBy: 'person-1',
      notes: 'Ravi',
    });
  });

  it('it records no status change (from == to), so the sender status history does not list it as a move', async () => {
    const { svc, create } = setup(
      TransferKind.INTERNAL,
      TransferStatus.IN_TRANSIT,
    );
    await svc.pickUp(['t1'], 'tenant', 'p', 'B', {});
    const data = create.mock.calls[0]![0].data;
    expect(data.fromStatus).toBe(SampleStatus.SENT_INTERNAL);
    expect(data.toStatus).toBe(SampleStatus.SENT_INTERNAL);
    expect(data.notes).toBeNull();
  });

  it('Receive writes a transfer-receive row carrying the condition it arrived in', async () => {
    const { svc, create } = setup(
      TransferKind.INTERNAL,
      TransferStatus.PICKED_UP,
    );
    await svc.receive(['t1'], 'tenant', 'person-2', 'B', {
      receiveCondition: 'Satisfactory',
    });
    expect(create.mock.calls[0]![0].data).toMatchObject({
      action: 'transfer-receive',
      changedBy: 'person-2',
      notes: 'Satisfactory',
    });
  });

  it('an EXTERNAL transfer leaves no step row (only Internal has this timeline)', async () => {
    const { svc, create } = setup(
      TransferKind.EXTERNAL,
      TransferStatus.IN_TRANSIT,
    );
    await svc.pickUp(['t1'], 'tenant', 'p', 'B', {});
    expect(create).not.toHaveBeenCalled();
  });
});

describe('SampleTransferService.findTransferTimeline', () => {
  const T1 = new Date('2026-10-22T10:00:00Z'); // the transfer to B
  const T2 = new Date('2026-10-25T10:00:00Z'); // the later transfer of the same sample (to C)
  const transfer = {
    id: 't1',
    sampleId: 's1',
    clonedSampleId: 'c1',
    createdAt: T1,
    originBranchId: 'bA',
    destinationBranchId: 'bB',
  };
  const row = (id: string, at: string, over: Record<string, unknown> = {}) => ({
    id,
    branchId: null,
    action: 'collect',
    fromStatus: SampleStatus.NEW,
    toStatus: SampleStatus.COLLECTED,
    reason: null,
    notes: null,
    changedBy: 'p1',
    createdAt: new Date(at),
    actorName: 'Asha',
    actorRole: null,
    ...over,
  });

  function setup(
    opts: {
      siblings?: Date[];
      copyMissing?: boolean;
      /** what the receiving branch did with this transfer (the transfer's status) */
      returned?: 'REPEAT' | 'REJECTED';
    } = {},
  ) {
    const findHistory = jest.fn((id: string) => {
      if (id === 's1') {
        return Promise.resolve([
          // newest first, like the real read
          row('later', '2026-10-26T09:00:00Z', { action: 'send' }), // the NEXT chapter (to C)
          row('back', '2026-10-23T09:00:00Z', {
            action: 'returned-by-receiver',
          }),
          row('send', '2026-10-22T10:00:00Z', { action: 'send' }),
          row('collect', '2026-10-21T09:00:00Z'),
        ]);
      }
      if (opts.copyMissing)
        return Promise.reject(new OrderSampleNotFoundException(id));
      return Promise.resolve([
        row('accept', '2026-10-22T14:00:00Z', {
          action: 'transfer-accept',
          fromStatus: null,
          branchId: 'bB',
        }),
      ]);
    });
    const enrichHistoryActors = jest.fn((rows: unknown[]) =>
      Promise.resolve(
        rows.map((r) => ({
          ...(r as object),
          actorName: 'Ravi',
          actorRole: null,
        })),
      ),
    );
    const prisma = {
      sampleTransfer: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            (opts.siblings ?? [T1, T2]).map((createdAt) => ({ createdAt })),
          ),
      },
      orderSampleStatusHistory: {
        findMany: jest.fn().mockResolvedValue([
          row('pick-old', '2026-10-22T11:00:00Z', {
            action: 'transfer-pickup',
            branchId: 'bB',
            fromStatus: SampleStatus.SENT_INTERNAL,
            toStatus: SampleStatus.SENT_INTERNAL,
          }),
          row('recv-old', '2026-10-22T12:00:00Z', {
            action: 'transfer-receive',
            branchId: 'bB',
            notes: 'Satisfactory',
            fromStatus: SampleStatus.SENT_INTERNAL,
            toStatus: SampleStatus.SENT_INTERNAL,
          }),
          // a step of the LATER transfer (to C): must not appear in the timeline of the one to B
          row('pick-later', '2026-10-26T11:00:00Z', {
            action: 'transfer-pickup',
            branchId: 'bC',
          }),
        ]),
      },
      branch: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'bA', name: 'Branch A' },
          { id: 'bB', name: 'Branch B' },
        ]),
      },
    };
    const samples = { findHistory, enrichHistoryActors };
    const svc = new SampleTransferService(
      prisma as never,
      samples as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(svc, 'findTransferById').mockResolvedValue(
      (opts.returned
        ? {
            ...transfer,
            kind: TransferKind.INTERNAL,
            transferStatus:
              opts.returned === 'REPEAT'
                ? TransferStatus.REPEAT
                : TransferStatus.REJECTED,
            rejectionReason: null,
            repeatReason: null,
          }
        : transfer) as never,
    );
    return { svc, findHistory };
  }

  it('merges sender story, steps and the receiver copy, oldest first, labelled by branch', async () => {
    const { svc } = setup();
    const t = await svc.findTransferTimeline('t1', 'tenant', 'bB');
    expect(t.map((e) => [e.id, e.side, e.branchName])).toEqual([
      ['collect', 'sender', 'Branch A'],
      ['send', 'sender', 'Branch A'],
      ['pick-old', 'step', 'Branch B'],
      ['recv-old', 'step', 'Branch B'],
      ['accept', 'receiver', 'Branch B'],
      // what the RECEIVING branch did is shown at the receiving branch (it is stored under the sender's)
      ['back', 'receiver', 'Branch B'],
    ]);
  });

  it("stops at the next transfer of the same sample: its steps and the sender's later chapter are left out", async () => {
    const { svc } = setup();
    const ids = (await svc.findTransferTimeline('t1', 'tenant', 'bB')).map(
      (e) => e.id,
    );
    expect(ids).not.toContain('later');
    expect(ids).not.toContain('pick-later');
  });

  it('a transfer the receiving branch sent back ends at that send-back: the next chapter is not shown, a Repeat is named', async () => {
    const { svc } = setup({ siblings: [T1], returned: 'REPEAT' });
    const t = await svc.findTransferTimeline('t1', 'tenant', 'bB');
    const ids = t.map((e) => e.id);
    expect(ids).not.toContain('later'); // the sender's later Send belongs to the next transfer
    expect(ids).toEqual(expect.arrayContaining(['collect', 'send', 'back']));
    expect(t.find((e) => e.id === 'back')).toMatchObject({
      display: 'repeat-requested',
      side: 'receiver',
      branchName: 'Branch B',
    });
  });

  it('a Reject is told apart from a Repeat', async () => {
    const { svc } = setup({ siblings: [T1], returned: 'REJECTED' });
    const back = (await svc.findTransferTimeline('t1', 'tenant', 'bB')).find(
      (e) => e.id === 'back',
    );
    expect(back?.display).toBe('rejected');
  });

  it('the latest transfer of a sample has no end: the whole later story is its own', async () => {
    const { svc } = setup({ siblings: [T1] });
    const ids = (await svc.findTransferTimeline('t1', 'tenant', 'bB')).map(
      (e) => e.id,
    );
    expect(ids).toContain('later');
  });

  it("carries the step's note (the condition) and the actor", async () => {
    const { svc } = setup();
    const recv = (await svc.findTransferTimeline('t1', 'tenant', 'bB')).find(
      (e) => e.id === 'recv-old',
    );
    expect(recv).toMatchObject({
      notes: 'Satisfactory',
      actorName: 'Ravi',
      action: 'transfer-receive',
    });
  });

  it("a copy that is out of this branch's sight leaves the rest of the story standing", async () => {
    const { svc } = setup({ copyMissing: true });
    const t = await svc.findTransferTimeline('t1', 'tenant', 'bA');
    // the copy's own line ('accept') is left out; the sender's rows stay
    expect(t.map((e) => e.id)).not.toContain('accept');
    expect(t.map((e) => e.id)).toContain('send');
  });

  it('reads the sender and the copy through the same access-checked history read', async () => {
    const { svc, findHistory } = setup();
    await svc.findTransferTimeline('t1', 'tenant', 'bB');
    expect(findHistory).toHaveBeenCalledWith('s1', 'tenant', 'bB');
    expect(findHistory).toHaveBeenCalledWith('c1', 'tenant', 'bB');
  });
});
