import { TransferKind, TransferStatus } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import { TransferOrderCancelledException } from './exceptions/accession.exceptions';

/**
 * D6 - a group "skip invalid" Pick up / Receive / Accept used to fail as a whole when
 * ONE transfer belonged to a cancelled order (409, nothing done). It now skips that
 * transfer, says why, and carries on with the others.
 * D2 - a group action works through its transfers in ONE fixed order (sorted by id), so
 * two overlapping groups picked in opposite orders cannot deadlock; the result is still
 * reported in the order the caller asked.
 */

const TENANT = 't1';
const PERSON = 'p1';

type Result = {
  succeeded: { id: string }[];
  skipped: {
    id: string;
    accessionNo: string | null;
    reason: string;
    code?: string;
  }[];
};

/** Several INTERNAL transfers in `status`; `cancelled` are the transfer ids whose order is cancelled. */
function group(
  status: TransferStatus,
  ids: string[],
  cancelled: string[] = [],
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    sampleTransfer: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({
            id: where.id,
            sampleId: `s-${where.id}`,
            kind: TransferKind.INTERNAL,
            transferStatus: status,
            destinationBranchId: 'B',
            receiveCondition: null,
            clonedSampleId: null,
          }),
        ),
      findMany: jest
        .fn()
        .mockResolvedValue(
          ids.map((id) => ({ id, sample: { accessionNo: `ACC-${id}` } })),
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orderSample: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ orderId: `o-${where.id}` }),
        ),
    },
    // the "test removed from the order" probe: no removed test
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    sampleTransfer: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id }),
        ),
    },
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const samples = {
    isOrderCancelled: jest
      .fn()
      .mockImplementation((_tx: unknown, _t: string, orderId: string) =>
        Promise.resolve(cancelled.includes(orderId.replace('o-s-', ''))),
      ),
    transitionInTx: jest.fn().mockResolvedValue({}),
    returnCopyToOrigin: jest.fn().mockResolvedValue('sA'),
    notifySamplesRepeated: jest.fn().mockResolvedValue(undefined),
    removeTransferCloneInTx: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new SampleTransferService(
    prisma as never,
    samples as never,
    {} as never,
    {} as never,
  );
  const idsOf = (mock: jest.Mock) =>
    mock.mock.calls.map(
      (c: unknown[]) => (c[0] as { where: { id: string } }).where.id,
    );
  return {
    svc,
    tx,
    samples,
    /** transfers written (updated), in order */
    written: () => idsOf(tx.sampleTransfer.updateMany),
    /** transfers looked at, in order = the order locks are taken */
    visited: () => idsOf(tx.sampleTransfer.findFirst),
  };
}

const receive = (m: ReturnType<typeof group>, ids: string[], skip = false) =>
  m.svc.receive(
    ids,
    TENANT,
    PERSON,
    'B',
    {} as never,
    skip,
  ) as unknown as Promise<Result>;

describe('D6 - a cancelled-order transfer is skipped in a group, not fatal', () => {
  it('Receive with skip invalid: the cancelled one is skipped with its reason and code, the others are done', async () => {
    const m = group(TransferStatus.PICKED_UP, ['t1', 't2', 't3'], ['t2']);
    const result = await receive(m, ['t1', 't2', 't3'], true);
    expect(result.succeeded.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      id: 't2',
      accessionNo: 'ACC-t2',
      code: 'TRANSFER_ORDER_CANCELLED',
    });
    expect(result.skipped[0]!.reason).toContain(
      'This order has been cancelled',
    );
    // nothing is written for the skipped transfer
    expect(m.written().sort()).toEqual(['t1', 't3']);
  });

  it('Pick up with skip invalid does the same', async () => {
    const m = group(TransferStatus.IN_TRANSIT, ['t1', 't2'], ['t1']);
    const result = (await m.svc.pickUp(
      ['t1', 't2'],
      TENANT,
      PERSON,
      'B',
      {},
      true,
    )) as unknown as Result;
    expect(result.succeeded.map((t) => t.id)).toEqual(['t2']);
    expect(result.skipped.map((s) => s.id)).toEqual(['t1']);
    expect(m.written()).toEqual(['t2']);
  });

  it('Accept with skip invalid skips the cancelled ones and creates no copy for them', async () => {
    const m = group(TransferStatus.RECEIVED, ['t1', 't2'], ['t1', 't2']);
    const result = (await m.svc.accept(
      ['t1', 't2'],
      TENANT,
      PERSON,
      'B',
      {},
      true,
    )) as unknown as Result;
    expect(result.succeeded).toEqual([]);
    expect(result.skipped.map((s) => s.id)).toEqual(['t1', 't2']);
    expect(
      result.skipped.every((s) => s.code === 'TRANSFER_ORDER_CANCELLED'),
    ).toBe(true);
    expect(m.written()).toEqual([]);
  });

  it('when every transfer is cancelled, nothing is done and everything is reported skipped', async () => {
    const m = group(TransferStatus.PICKED_UP, ['t1', 't2'], ['t1', 't2']);
    const result = await receive(m, ['t1', 't2'], true);
    expect(result.succeeded).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(m.written()).toEqual([]);
  });

  it('without skip invalid a cancelled transfer still refuses (409), as before', async () => {
    const m = group(TransferStatus.PICKED_UP, ['t1', 't2'], ['t2']);
    await expect(receive(m, ['t1', 't2'])).rejects.toBeInstanceOf(
      TransferOrderCancelledException,
    );
  });

  it('a single action on a cancelled order still refuses (409), as before', async () => {
    const m = group(TransferStatus.PICKED_UP, ['t1'], ['t1']);
    await expect(receive(m, ['t1'])).rejects.toBeInstanceOf(
      TransferOrderCancelledException,
    );
  });

  it('a group with no cancelled order behaves exactly as before', async () => {
    const m = group(TransferStatus.PICKED_UP, ['t1', 't2']);
    const result = await receive(m, ['t1', 't2'], true);
    expect(result.skipped).toEqual([]);
    expect(result.succeeded).toHaveLength(2);
  });

  it('Reject of a cancelled order stays open (not checked, not skipped)', async () => {
    const m = group(TransferStatus.RECEIVED, ['t1'], ['t1']);
    const result = (await m.svc.reject(
      ['t1'],
      TENANT,
      PERSON,
      'B',
      { rejectionReason: 'Cancelled' },
      true,
    )) as unknown as Result;
    expect(result.skipped).toEqual([]);
    expect(result.succeeded).toHaveLength(1);
    expect(m.samples.isOrderCancelled).not.toHaveBeenCalled();
  });
});

describe('D2 - one fixed processing order, result in the requested order', () => {
  it('works through the transfers sorted by id, whatever order they were selected in', async () => {
    const m = group(TransferStatus.PICKED_UP, ['tC', 'tA', 'tB']);
    await receive(m, ['tC', 'tA', 'tB']);
    expect(m.visited()).toEqual(['tA', 'tB', 'tC']);
    expect(m.written()).toEqual(['tA', 'tB', 'tC']);
  });

  it('two overlapping groups picked in opposite orders take their locks in the SAME order', async () => {
    const first = group(TransferStatus.PICKED_UP, ['t1', 't2', 't3']);
    await receive(first, ['t1', 't2', 't3']);
    const second = group(TransferStatus.PICKED_UP, ['t3', 't2', 't1']);
    await receive(second, ['t3', 't2', 't1']);
    expect(second.visited()).toEqual(first.visited());
  });

  it('reports the succeeded transfers in the order they were asked for', async () => {
    const m = group(TransferStatus.PICKED_UP, ['tC', 'tA', 'tB']);
    const result = await receive(m, ['tC', 'tA', 'tB']);
    expect(result.succeeded.map((t) => t.id)).toEqual(['tC', 'tA', 'tB']);
  });

  it('reports the skipped transfers in the order they were asked for', async () => {
    const m = group(TransferStatus.PICKED_UP, ['tC', 'tA', 'tB'], ['tA', 'tC']);
    const result = await receive(m, ['tC', 'tA', 'tB'], true);
    expect(result.skipped.map((s) => s.id)).toEqual(['tC', 'tA']);
    expect(result.succeeded.map((t) => t.id)).toEqual(['tB']);
  });

  it('does not change the array the caller passed in', async () => {
    const m = group(TransferStatus.PICKED_UP, ['tC', 'tA', 'tB']);
    const ids = ['tC', 'tA', 'tB'];
    await receive(m, ids);
    expect(ids).toEqual(['tC', 'tA', 'tB']);
  });

  it('a single transfer is unaffected', async () => {
    const m = group(TransferStatus.PICKED_UP, ['t1']);
    const result = await receive(m, ['t1']);
    expect(result.succeeded.map((t) => t.id)).toEqual(['t1']);
    expect(m.visited()).toEqual(['t1']);
  });

  it('Reject and Repeat groups use the same fixed order too', async () => {
    const r = group(TransferStatus.RECEIVED, ['tB', 'tA']);
    await r.svc.reject(['tB', 'tA'], TENANT, PERSON, 'B', {
      rejectionReason: 'x',
    });
    expect(r.visited()).toEqual(['tA', 'tB']);
    const p = group(TransferStatus.RECEIVED, ['tB', 'tA']);
    await p.svc.repeatTransfer(['tB', 'tA'], TENANT, PERSON, 'B', {
      repeatReason: 'x',
    });
    expect(p.visited()).toEqual(['tA', 'tB']);
  });
});
