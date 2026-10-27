import { TransferKind, TransferStatus } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import {
  TransferCenterChangedException,
  TransferNotEditableException,
} from './exceptions/accession.exceptions';

/**
 * Changing the destination of an INTERNAL transfer (Edit Center): a transfer the first
 * branch had already PICKED UP starts over at In-Transit (the new branch has not picked
 * it up, and the old branch's pick-up must not be shown as the new branch's), and every
 * change of destination leaves a sample-history row and Audit-log entries for the
 * branches that gain or lose the transfer.
 */
const BR = { A: 'br-a', B: 'br-b', C: 'br-c' };
const ACTOR = { roleKey: 'accession_manager', roleLabel: 'Accession Manager' };

const callsOf = (m: jest.Mock): unknown[][] => m.mock.calls as unknown[][];

interface Over {
  status?: TransferStatus;
  from?: string | null;
  to?: string;
  logistics?: string | null;
  dtoLogistics?: string;
  pickedUpStillCurrent?: boolean;
  /** The destination the dialog showed (null = none); omitted = no check. */
  expected?: string | null;
  /** The destination write matches nothing (the row changed under us). */
  writeMisses?: boolean;
  /** The row as it is when the write missed. */
  nowRow?: {
    transferStatus: TransferStatus;
    destinationBranchId: string | null;
  } | null;
}

function setup(o: Over = {}) {
  const status = o.status ?? TransferStatus.IN_TRANSIT;
  const to = o.to ?? BR.C;
  const from = o.from === undefined ? BR.B : o.from;
  const tx = {
    sampleTransfer: {
      // 1st call: the conditional destination write; 2nd: the Picked-Up reset
      findFirst: jest.fn().mockResolvedValue(o.nowRow ?? null),
      updateMany: jest
        .fn()
        .mockResolvedValueOnce({ count: o.writeMisses ? 0 : 1 })
        .mockResolvedValueOnce({
          count:
            (o.pickedUpStillCurrent ?? status === TransferStatus.PICKED_UP)
              ? 1
              : 0,
        }),
    },
    orderSample: {
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({
        id: 's1',
        branchId: BR.A,
        status: 'SENT_INTERNAL',
        accessionNo: 'ACC-1',
        order: { orderCode: 'ORD-9' },
      }),
    },
    branch: {
      findMany: jest.fn().mockResolvedValue([
        { id: BR.A, name: 'Branch A' },
        { id: BR.B, name: 'Branch B' },
        { id: BR.C, name: 'Branch C' },
      ]),
    },
    orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const samples = { recordNoteInTx: jest.fn().mockResolvedValue(undefined) };
  const svc = new SampleTransferService(
    {} as never,
    samples as never,
    {} as never,
    {} as never,
  );
  const prepared = {
    transferId: 't1',
    transfer: {
      kind: TransferKind.INTERNAL,
      transferStatus: status,
      sampleId: 's1',
      destinationBranchId: from,
      logisticsType: o.logistics === undefined ? 'Courier' : o.logistics,
    },
    dto: {
      destinationBranchId: to,
      ...(o.dtoLogistics ? { logisticsType: o.dtoLogistics } : {}),
    },
    data: {},
    ...(o.expected !== undefined ? { expectedDestination: o.expected } : {}),
  };
  const persist = (personId: string | null = 'p1') =>
    (
      svc as unknown as {
        persistCenterChange: (...a: unknown[]) => Promise<void>;
      }
    ).persistCenterChange(tx, 't1', personId, prepared, ACTOR);
  const audits = () =>
    callsOf(tx.auditLog.create).map(
      (c) =>
        (c[0] as { data: Record<string, unknown> }).data as {
          branchId: string | null;
          description: string;
          resourceId: string;
          actorRoleLabel: string | null;
          metadata: Record<string, unknown>;
        },
    );
  return { tx, samples, persist, audits };
}

describe('Edit Center: a Picked-Up transfer re-addressed to another branch', () => {
  it('starts over at In-Transit and clears who picked it up and when', async () => {
    const { tx, persist } = setup({ status: TransferStatus.PICKED_UP });
    await persist();
    const reset = callsOf(tx.sampleTransfer.updateMany)[1]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(reset.where).toMatchObject({
      id: 't1',
      deletedAt: null,
      transferStatus: TransferStatus.PICKED_UP,
    });
    expect(reset.data).toEqual({
      transferStatus: TransferStatus.IN_TRANSIT,
      pickedUpBy: null,
      pickedUpAt: null,
    });
  });

  it('says so on the sample history and in the audit trail of BOTH branches', async () => {
    const { tx, persist, audits } = setup({ status: TransferStatus.PICKED_UP });
    await persist();
    const hist = (
      callsOf(tx.orderSampleStatusHistory.create)[0]![0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(hist).toMatchObject({
      action: 'assign-center',
      fromStatus: 'SENT_INTERNAL',
      toStatus: 'SENT_INTERNAL',
      changedBy: 'p1',
    });
    expect(hist.notes).toContain('from Branch B to Branch C while Picked Up');
    expect(hist.notes).toContain('starts over at In-Transit');

    const a = audits();
    expect(a.map((x) => [x.branchId, x.metadata.side])).toEqual([
      [BR.A, 'sender'],
      [BR.B, 'old-receiver'],
      [BR.C, 'new-receiver'],
    ]);
    expect(a[1]!.description).toContain('no longer coming to Branch B');
    expect(a.every((x) => x.resourceId === 's1')).toBe(true);
    expect(a.every((x) => x.actorRoleLabel === 'Accession Manager')).toBe(true);
    expect(a[0]!.metadata).toMatchObject({
      accessionNo: 'ACC-1',
      orderCode: 'ORD-9',
      stage: 'Picked Up',
      fromBranch: 'Branch B',
      toBranch: 'Branch C',
      pickedUpReset: true,
    });
  });

  it('the sample also follows the new destination', async () => {
    const { tx, persist } = setup({ status: TransferStatus.PICKED_UP });
    await persist();
    const arg = callsOf(tx.orderSample.update)[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.processingBranchId).toBe(BR.C);
  });

  it('a transfer that was picked up but is no longer Picked Up when written (reset matches nothing) is not described as reset', async () => {
    const { persist, audits } = setup({
      status: TransferStatus.PICKED_UP,
      pickedUpStillCurrent: false,
    });
    await persist();
    expect(audits()[0]!.metadata.pickedUpReset).toBe(false);
    expect(audits()[0]!.description).not.toContain('starts over');
  });
});

describe('Edit Center: an In-Transit transfer', () => {
  it('keeps its status (nothing to reset) and is logged for both branches when it was visible', async () => {
    const { persist, audits } = setup({ status: TransferStatus.IN_TRANSIT });
    await persist();
    const a = audits();
    expect(a.map((x) => x.metadata.side)).toEqual([
      'sender',
      'old-receiver',
      'new-receiver',
    ]);
    expect(a[0]!.metadata).toMatchObject({
      stage: 'In-Transit',
      pickedUpReset: false,
    });
    expect(a[0]!.description).not.toContain('starts over');
  });

  it('without a logistics type neither branch could see it: only the sender is logged', async () => {
    const { persist, audits } = setup({ logistics: null });
    await persist();
    expect(audits().map((x) => x.metadata.side)).toEqual(['sender']);
  });

  it('a logistics type set in the same change makes it visible to the NEW branch only', async () => {
    const { persist, audits } = setup({
      logistics: null,
      dtoLogistics: 'Courier',
    });
    await persist();
    expect(audits().map((x) => x.metadata.side)).toEqual([
      'sender',
      'new-receiver',
    ]);
  });

  it('a first center (none before) is recorded as an assignment, with no old branch', async () => {
    const { tx, persist, audits } = setup({ from: null });
    await persist();
    const hist = (
      callsOf(tx.orderSampleStatusHistory.create)[0]![0] as {
        data: Record<string, unknown>;
      }
    ).data;
    expect(hist.notes).toBe('Center assigned: Branch C');
    expect(audits().map((x) => x.metadata.side)).toEqual([
      'sender',
      'new-receiver',
    ]);
  });
});

describe('Edit Center: nothing to record when the destination does not change', () => {
  it('a logistics-only edit (same destination) neither resets nor logs a re-address', async () => {
    const { tx, persist, audits } = setup({
      status: TransferStatus.PICKED_UP,
      to: BR.B,
    });
    await persist();
    expect(tx.sampleTransfer.updateMany).toHaveBeenCalledTimes(1); // only the destination write
    expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
  });

  it('with no acting person the history row is still written but no audit entry', async () => {
    const { tx, persist, audits } = setup({ status: TransferStatus.PICKED_UP });
    await persist(null);
    expect(tx.orderSampleStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(audits()).toHaveLength(0);
  });
});

describe('Edit Center: a stale dialog cannot overwrite a newer change', () => {
  const firstWhere = (tx: ReturnType<typeof setup>['tx']) =>
    (
      callsOf(tx.sampleTransfer.updateMany)[0]![0] as {
        where: Record<string, unknown>;
      }
    ).where;

  it('the write is conditional on the center the dialog showed', async () => {
    const { tx, persist } = setup({ expected: BR.B });
    await persist();
    expect(firstWhere(tx).destinationBranchId).toBe(BR.B);
  });

  it('a tube that had no center is written only while it still has none', async () => {
    const { tx, persist } = setup({ from: null, expected: null });
    await persist();
    expect('destinationBranchId' in firstWhere(tx)).toBe(true);
    expect(firstWhere(tx).destinationBranchId).toBeNull();
  });

  it('with no expected center (an older caller) the write is not conditioned on it', async () => {
    const { tx, persist } = setup();
    await persist();
    expect('destinationBranchId' in firstWhere(tx)).toBe(false);
  });

  it('refuses with TRANSFER_CENTER_CHANGED when the center was changed after the check, and records nothing', async () => {
    const { tx, persist, audits } = setup({
      expected: BR.B,
      writeMisses: true,
      nowRow: {
        transferStatus: TransferStatus.IN_TRANSIT,
        destinationBranchId: BR.C,
      },
    });
    await expect(persist()).rejects.toBeInstanceOf(
      TransferCenterChangedException,
    );
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
  });

  it('a transfer that was received in the meantime is still reported as not editable', async () => {
    const { persist } = setup({
      expected: BR.B,
      writeMisses: true,
      nowRow: {
        transferStatus: TransferStatus.RECEIVED,
        destinationBranchId: BR.C,
      },
    });
    await expect(persist()).rejects.toBeInstanceOf(
      TransferNotEditableException,
    );
  });

  it('a missed write with no expected center is reported as not editable', async () => {
    const { persist } = setup({
      writeMisses: true,
      nowRow: {
        transferStatus: TransferStatus.IN_TRANSIT,
        destinationBranchId: BR.C,
      },
    });
    await expect(persist()).rejects.toBeInstanceOf(
      TransferNotEditableException,
    );
  });
});
