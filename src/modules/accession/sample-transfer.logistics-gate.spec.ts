import { Prisma, TransferKind, TransferStatus } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import { AccessionDashboardService } from './accession-dashboard.service';
import {
  HIDDEN_FROM_RECEIVER_WHERE,
  isHiddenFromReceiver,
} from './utils/receiver-visibility.util';

/**
 * An INTERNAL transfer that is still In-Transit with no logistics type is hidden from
 * the RECEIVING branch (how it travels is undecided) and cannot be picked up. Once
 * picked up (or later) it is unaffected; EXTERNAL / OUTSOURCE are never HIDDEN (and an unassigned
 * OUTSOURCE has its own pick-up rule, see sample-transfer.outsource-assigned.spec.ts).
 */
describe('isHiddenFromReceiver', () => {
  const t = (over: Record<string, unknown> = {}) => ({
    kind: TransferKind.INTERNAL,
    transferStatus: TransferStatus.IN_TRANSIT,
    logisticsType: null as string | null,
    ...over,
  });

  it.each([null, '', '   '])(
    'an INTERNAL In-Transit transfer with logistics %j is hidden',
    (logisticsType) => {
      expect(isHiddenFromReceiver(t({ logisticsType }))).toBe(true);
    },
  );

  it('is visible once a logistics type is set', () => {
    expect(isHiddenFromReceiver(t({ logisticsType: 'Courier' }))).toBe(false);
  });

  it.each([
    TransferStatus.PICKED_UP,
    TransferStatus.RECEIVED,
    TransferStatus.ACCEPTED,
    TransferStatus.REPEAT,
    TransferStatus.REJECTED,
  ])(
    'a transfer already %s is never hidden, whatever its logistics',
    (transferStatus) => {
      expect(isHiddenFromReceiver(t({ transferStatus }))).toBe(false);
    },
  );

  it.each([TransferKind.EXTERNAL, TransferKind.OUTSOURCE])(
    'a %s transfer is never hidden',
    (kind) => {
      expect(isHiddenFromReceiver(t({ kind }))).toBe(false);
    },
  );

  it('the Prisma condition names exactly those three tests', () => {
    expect(HIDDEN_FROM_RECEIVER_WHERE).toEqual({
      kind: TransferKind.INTERNAL,
      transferStatus: TransferStatus.IN_TRANSIT,
      OR: [{ logisticsType: null }, { logisticsType: '' }],
    });
  });
});

describe('SampleTransferService.findTransfers — the receiving branch does not see an In-Transit transfer without logistics', () => {
  const findMany = jest.fn<
    Promise<unknown[]>,
    [{ where: Prisma.SampleTransferWhereInput }]
  >();
  const count = jest.fn().mockResolvedValue(0);
  const tx = {
    tenant: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ groupingMode: 'DEPARTMENT_SAMPLE_NAME' }),
    },
    sampleTransfer: { findMany, count },
  };
  const prisma = {
    withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const service = new SampleTransferService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  const whereOf = async (direction?: 'incoming' | 'outgoing') => {
    findMany.mockReset().mockResolvedValue([]);
    await service.findTransfers('t1', 'b1', { direction });
    return findMany.mock.calls[0]![0].where;
  };

  it('the incoming (default) list excludes the hidden transfers', async () => {
    for (const where of [await whereOf(), await whereOf('incoming')]) {
      expect(where.destinationBranchId).toBe('b1');
      expect(where.AND).toEqual([{ NOT: HIDDEN_FROM_RECEIVER_WHERE }]);
    }
  });

  it("the sender's outgoing list is unchanged: it still sees its own transfers", async () => {
    const where = await whereOf('outgoing');
    expect(where.originBranchId).toBe('b1');
    expect(where.AND).toBeUndefined();
  });
});

describe('SampleTransferService.pickUp — refused while In-Transit with no logistics', () => {
  function setup(row: Record<string, unknown>) {
    const transfer = {
      id: 'tr1',
      sampleId: 'sA',
      kind: TransferKind.INTERNAL,
      transferStatus: TransferStatus.IN_TRANSIT,
      destinationBranchId: 'B',
      logisticsType: null,
      ...row,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      sampleTransfer: {
        findFirst: jest.fn().mockResolvedValue(transfer),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderSample: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ orderId: 'o1' }),
      },
      orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
      sampleTransfer: { findFirst: jest.fn().mockResolvedValue(transfer) },
      orderSample: {
        findFirst: jest.fn().mockResolvedValue({ orderId: 'o1' }),
      },
      orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const samples = {
      isOrderCancelled: jest.fn().mockResolvedValue(false),
    };
    const svc = new SampleTransferService(
      prisma as never,
      samples as never,
      {} as never,
      {} as never,
    );
    return { svc, tx };
  }
  const pick = (
    svc: SampleTransferService,
    ids: string[] = ['tr1'],
    skip = false,
  ) => svc.pickUp(ids, 't1', 'p1', 'B', {}, skip);

  it('a single Pick Up is refused with 422 TRANSFER_LOGISTICS_MISSING and writes nothing', async () => {
    const { svc, tx } = setup({});
    await expect(pick(svc)).rejects.toMatchObject({
      errorCode: 'TRANSFER_LOGISTICS_MISSING',
    });
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
  });

  it('a group call with skip invalid skips it with the reason and the code', async () => {
    const { svc, tx } = setup({});
    const r = await pick(svc, ['tr1'], true);
    expect(r.succeeded).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({
      id: 'tr1',
      code: 'TRANSFER_LOGISTICS_MISSING',
      reason: 'Logistics type not set by the sending branch yet.',
    });
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
  });

  it('with a logistics type set the Pick Up goes through', async () => {
    const { svc, tx } = setup({ logisticsType: 'Courier' });
    const r = await pick(svc);
    expect(r.succeeded.length).toBe(1);
    expect(tx.sampleTransfer.updateMany).toHaveBeenCalledTimes(1);
  });

  // An EXTERNAL transfer is not covered by this rule. (An OUTSOURCE transfer has its own, stricter rule: it
  // needs a center AND a logistics type before pick-up - see sample-transfer.outsource-assigned.spec.ts.)
  it('an EXTERNAL transfer with no logistics is not affected', async () => {
    const { svc } = setup({
      kind: TransferKind.EXTERNAL,
      destinationBranchId: null,
    });
    const r = await pick(svc);
    expect(r.succeeded.length).toBe(1);
  });
});

describe('AccessionDashboardService.getInternalReferralOrders — "received" leaves out what the receiver cannot see yet', () => {
  it('the received count excludes In-Transit transfers with no logistics; the sent count does not', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const prisma = {
      sampleTransfer: { groupBy },
      branch: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AccessionDashboardService(prisma as never, {} as never);
    await service.getInternalReferralOrders('t1', 'B');
    const calls = groupBy.mock.calls as Array<
      [{ by: string[]; where: Record<string, unknown> }]
    >;
    const sent = calls.find((c) => c[0].by[0] === 'destinationBranchId')![0];
    const received = calls.find((c) => c[0].by[0] === 'originBranchId')![0];
    expect(received.where.NOT).toEqual(HIDDEN_FROM_RECEIVER_WHERE);
    expect(sent.where.NOT).toBeUndefined();
  });
});
