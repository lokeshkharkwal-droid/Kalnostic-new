import { TransferKind, TransferStatus } from '@prisma/client';
import {
  findReceiverReturns,
  receiverReturnOf,
  RETURNED_BY_RECEIVER_ACTION,
} from './returned-by-receiver.util';

const row = (over: Record<string, unknown> = {}) => ({
  kind: TransferKind.INTERNAL,
  transferStatus: TransferStatus.REPEAT,
  rejectionReason: null,
  repeatReason: null,
  ...over,
});

describe('receiverReturnOf', () => {
  it('an INTERNAL transfer closed as REPEAT is a send-back, with the repeat reason', () => {
    expect(receiverReturnOf(row({ repeatReason: 'clotted' }))).toEqual({
      kind: 'REPEAT',
      reason: 'clotted',
    });
  });

  it('an INTERNAL transfer REJECTED by the receiving branch is a send-back, with the rejection reason', () => {
    expect(
      receiverReturnOf(
        row({
          transferStatus: TransferStatus.REJECTED,
          rejectionReason: 'hemolysed',
        }),
      ),
    ).toEqual({ kind: 'REJECTED', reason: 'hemolysed' });
  });

  it.each(['Recalled via Retrieve', 'Order item removed'])(
    'a rejection the SYSTEM wrote ("%s") is not a decision of the receiving branch',
    (reason) => {
      expect(
        receiverReturnOf(
          row({
            transferStatus: TransferStatus.REJECTED,
            rejectionReason: reason,
          }),
        ),
      ).toBeNull();
    },
  );

  it.each([
    TransferStatus.IN_TRANSIT,
    TransferStatus.PICKED_UP,
    TransferStatus.RECEIVED,
    TransferStatus.ACCEPTED,
  ])('a transfer still open (%s) is not a send-back', (transferStatus) => {
    expect(receiverReturnOf(row({ transferStatus }))).toBeNull();
  });

  it.each([TransferKind.EXTERNAL, TransferKind.OUTSOURCE])(
    'a %s transfer is never a send-back (only branches send back)',
    (kind) => {
      expect(receiverReturnOf(row({ kind }))).toBeNull();
    },
  );

  it('no transfer at all is not a send-back', () => {
    expect(receiverReturnOf(undefined)).toBeNull();
    expect(receiverReturnOf(null)).toBeNull();
  });
});

describe('findReceiverReturns', () => {
  const db = (rows: unknown[]) => ({
    sampleTransfer: { findMany: jest.fn().mockResolvedValue(rows) },
  });

  it('asks nothing when there is nothing to ask about', async () => {
    const d = db([]);
    const out = await findReceiverReturns(d as never, 't1', []);
    expect(out.size).toBe(0);
    expect(d.sampleTransfer.findMany).not.toHaveBeenCalled();
  });

  it('one query for the whole set, newest first, INTERNAL and not deleted only', async () => {
    const d = db([]);
    await findReceiverReturns(d as never, 't1', ['s1', 's2', 's1']);
    expect(d.sampleTransfer.findMany).toHaveBeenCalledTimes(1);
    const firstArg: unknown = (
      d.sampleTransfer.findMany.mock.calls as unknown[][]
    )[0]![0];
    expect(firstArg).toMatchObject({
      where: {
        tenantId: 't1',
        sampleId: { in: ['s1', 's2'] },
        kind: TransferKind.INTERNAL,
        deletedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('only the LATEST transfer of a sample counts (an older send-back is history)', async () => {
    // newest first: s1's latest is open again (re-sent after the repeat), s2's latest is a rejection
    const d = db([
      { sampleId: 's1', ...row({ transferStatus: TransferStatus.IN_TRANSIT }) },
      { sampleId: 's1', ...row({ repeatReason: 'old' }) },
      {
        sampleId: 's2',
        ...row({
          transferStatus: TransferStatus.REJECTED,
          rejectionReason: 'leaked',
        }),
      },
    ]);
    const out = await findReceiverReturns(d as never, 't1', ['s1', 's2']);
    expect(out.has('s1')).toBe(false);
    expect(out.get('s2')).toEqual({ kind: 'REJECTED', reason: 'leaked' });
  });
});

describe('RETURNED_BY_RECEIVER_ACTION', () => {
  it('is the history action the sender-side trail row is written with', () => {
    expect(RETURNED_BY_RECEIVER_ACTION).toBe('returned-by-receiver');
  });
});
