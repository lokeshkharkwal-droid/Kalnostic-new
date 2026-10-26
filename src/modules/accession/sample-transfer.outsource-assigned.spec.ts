import { TransferKind, TransferStatus } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import { refusalMessage } from './exceptions/accession.exceptions';
import { missingOutsourceAssignment } from './utils/outsource-assignment.util';

/**
 * An OUTSOURCE transfer can be created without a center and without a logistics type (both are set
 * later through Assign Center), but it can not move until they are: Pick Up needs a center AND a
 * logistics type, Receive and Accept need a center. EXTERNAL transfers and the Repeat / Reject steps
 * are not covered.
 */
describe('missingOutsourceAssignment', () => {
  const t = (over: Record<string, unknown> = {}) => ({
    kind: TransferKind.OUTSOURCE,
    outsourceCenterId: null as string | null,
    logisticsType: null as string | null,
    ...over,
  });

  it('pick-up needs a center and a logistics type', () => {
    expect(missingOutsourceAssignment(t(), 'pick-up')).toEqual([
      'center',
      'logistics type',
    ]);
    expect(
      missingOutsourceAssignment(t({ outsourceCenterId: 'c1' }), 'pick-up'),
    ).toEqual(['logistics type']);
    expect(
      missingOutsourceAssignment(t({ logisticsType: 'Courier' }), 'pick-up'),
    ).toEqual(['center']);
    expect(
      missingOutsourceAssignment(
        t({ outsourceCenterId: 'c1', logisticsType: 'Courier' }),
        'pick-up',
      ),
    ).toEqual([]);
  });

  it.each([null, '', '   '])(
    'logistics %j counts as not set',
    (logisticsType) => {
      expect(
        missingOutsourceAssignment(
          t({ outsourceCenterId: 'c1', logisticsType }),
          'pick-up',
        ),
      ).toEqual(['logistics type']);
    },
  );

  it.each(['receive', 'accept'])(
    '%s needs a center only (it can only follow a pick-up)',
    (action) => {
      expect(missingOutsourceAssignment(t(), action)).toEqual(['center']);
      expect(
        missingOutsourceAssignment(t({ outsourceCenterId: 'c1' }), action),
      ).toEqual([]);
    },
  );

  it.each(['repeat', 'reject', 'assign-center', 'retrieve'])(
    '%s is never guarded',
    (action) => {
      expect(missingOutsourceAssignment(t(), action)).toEqual([]);
    },
  );

  it.each([TransferKind.INTERNAL, TransferKind.EXTERNAL])(
    'a %s transfer is not covered',
    (kind) => {
      expect(missingOutsourceAssignment(t({ kind }), 'pick-up')).toEqual([]);
    },
  );
});

describe('SampleTransferService - an unassigned OUTSOURCE transfer can not move', () => {
  function setup(row: Record<string, unknown>) {
    const transfer = {
      id: 'tr1',
      sampleId: 'sA',
      kind: TransferKind.OUTSOURCE,
      transferStatus: TransferStatus.IN_TRANSIT,
      destinationBranchId: null,
      outsourceCenterId: null,
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
    const samples = { isOrderCancelled: jest.fn().mockResolvedValue(false) };
    const svc = new SampleTransferService(
      prisma as never,
      samples as never,
      {} as never,
      {} as never,
    );
    return { svc, tx };
  }
  /** The refusal a call ends with (fails the test when it does not refuse). */
  const refused = async (call: Promise<unknown>) => {
    try {
      await call;
    } catch (e) {
      return e as { errorCode?: string };
    }
    throw new Error('expected a refusal');
  };
  const pick = (svc: SampleTransferService, skip = false) =>
    svc.pickUp(['tr1'], 't1', 'p1', 'A', {}, skip);
  const receive = (svc: SampleTransferService, skip = false) =>
    svc.receive(
      ['tr1'],
      't1',
      'p1',
      'A',
      { receiveCondition: 'Satisfactory' },
      skip,
    );
  const accept = (svc: SampleTransferService, skip = false) =>
    svc.accept(['tr1'], 't1', 'p1', 'A', {}, skip);

  it('Pick Up with no center and no logistics is refused (422) naming both, and writes nothing', async () => {
    const { svc, tx } = setup({});
    const e = await refused(pick(svc));
    expect(e.errorCode).toBe('TRANSFER_OUTSOURCE_NOT_ASSIGNED');
    expect(refusalMessage(e as never)).toBe(
      'This outsource transfer has no center and no logistics type yet. Use Assign Center in In-House Orders to set it, then try again.',
    );
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
  });

  it('a center without logistics is still refused, and the message names only what is missing', async () => {
    const { svc, tx } = setup({ outsourceCenterId: 'c1' });
    const e = await refused(pick(svc));
    expect(e.errorCode).toBe('TRANSFER_OUTSOURCE_NOT_ASSIGNED');
    expect(refusalMessage(e as never)).toContain('has no logistics type yet');
    expect(refusalMessage(e as never)).not.toContain('center and');
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
  });

  it('logistics without a center is refused too', async () => {
    const { svc } = setup({ logisticsType: 'Courier' });
    const e = await refused(pick(svc));
    expect(e.errorCode).toBe('TRANSFER_OUTSOURCE_NOT_ASSIGNED');
    expect(refusalMessage(e as never)).toContain('has no center yet');
  });

  it('with a center and a logistics type the Pick Up goes through', async () => {
    const { svc, tx } = setup({
      outsourceCenterId: 'c1',
      logisticsType: 'Courier',
    });
    const r = await pick(svc);
    expect(r.succeeded).toHaveLength(1);
    expect(tx.sampleTransfer.updateMany).toHaveBeenCalledTimes(1);
  });

  it('Receive and Accept need the center (logistics was needed at pick-up): refused without it, fine with it', async () => {
    const picked = { transferStatus: TransferStatus.PICKED_UP };
    await expect(receive(setup(picked).svc)).rejects.toMatchObject({
      errorCode: 'TRANSFER_OUTSOURCE_NOT_ASSIGNED',
    });
    expect(
      (await receive(setup({ ...picked, outsourceCenterId: 'c1' }).svc))
        .succeeded,
    ).toHaveLength(1);
    const received = { transferStatus: TransferStatus.RECEIVED };
    await expect(accept(setup(received).svc)).rejects.toMatchObject({
      errorCode: 'TRANSFER_OUTSOURCE_NOT_ASSIGNED',
    });
    expect(
      (await accept(setup({ ...received, outsourceCenterId: 'c1' }).svc))
        .succeeded,
    ).toHaveLength(1);
  });

  it('a group call with skip invalid skips it with the reason and the code, and writes nothing', async () => {
    const { svc, tx } = setup({});
    const r = await pick(svc, true);
    expect(r.succeeded).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({
      id: 'tr1',
      code: 'TRANSFER_OUTSOURCE_NOT_ASSIGNED',
      reason: expect.stringContaining('Assign Center') as string,
    });
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
  });

  it('an EXTERNAL (forward) transfer with nothing assigned is not covered', async () => {
    const { svc } = setup({ kind: TransferKind.EXTERNAL });
    expect((await pick(svc)).succeeded).toHaveLength(1);
  });
});
