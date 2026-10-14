import { SampleStatus, TransferKind, TransferStatus } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import {
  SampleReturnBlockedException,
  SampleSentToBranchException,
  InvalidTransferTransitionException,
  TransferOrderCancelledException,
  TransferDestinationMissingException,
  SendBlockedException,
  TransferNotEditableException,
  TransferWrongBranchException,
} from './exceptions/accession.exceptions';

const TENANT = 't1';
const PERSON = 'p1';

interface TransferRow {
  id: string;
  sampleId: string;
  kind: TransferKind;
  transferStatus: TransferStatus;
  destinationBranchId: string | null;
  receiveCondition: string | null;
  clonedSampleId?: string | null;
}

function setup(
  row: Partial<TransferRow>,
  opts: { updateCount?: number; copies?: { id: string }[] } = {},
) {
  const transfer: TransferRow = {
    id: 'tr1',
    sampleId: 'sA',
    kind: TransferKind.INTERNAL,
    transferStatus: TransferStatus.RECEIVED,
    destinationBranchId: 'B',
    receiveCondition: null,
    ...row,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    // savepoints taken around each send-back of a "skip invalid" group action
    $executeRaw: jest.fn().mockResolvedValue(0),
    sampleTransfer: {
      findFirst: jest.fn().mockResolvedValue(transfer),
      // skipInvalid pre-reads the accession numbers of the transfers it may skip.
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }),
    },
    orderSample: {
      findMany: jest.fn().mockResolvedValue(opts.copies ?? []),
      findFirst: jest.fn().mockResolvedValue({ orderId: 'o1' }),
    },
  };
  const prisma = {
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    sampleTransfer: { findFirst: jest.fn().mockResolvedValue(transfer) },
    orderSample: { findFirst: jest.fn().mockResolvedValue({ orderId: 'o1' }) },
  };
  const samples = {
    isOrderCancelled: jest.fn().mockResolvedValue(false),
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
  return { svc, tx, samples, prisma, transfer };
}

describe('SampleTransferService — return to sender', () => {
  it('reject from RECEIVED sends the original sample to REPEAT (system, forced)', async () => {
    const { svc, samples, tx } = setup({});
    await svc.reject(['tr1'], TENANT, PERSON, 'B', {
      rejectionReason: 'Leaked',
    });
    expect(samples.transitionInTx).toHaveBeenCalledTimes(1);
    const call = samples.transitionInTx.mock.calls[0] as unknown[];
    expect(call[4]).toBe('repeat');
    expect(call[3]).toBe('sA');
    expect(call[6]).toMatchObject({ force: true, system: true });
    expect(samples.returnCopyToOrigin).not.toHaveBeenCalled();
    // the sender's sample is notified once the transaction has committed
    expect(samples.notifySamplesRepeated).toHaveBeenCalledWith(TENANT, ['sA']);
    // the transfer row moves REJECTED, conditional on its current status
    const upd = (
      tx.sampleTransfer.updateMany.mock.calls[0] as unknown[]
    )[0] as {
      where: { transferStatus: TransferStatus };
      data: { transferStatus: TransferStatus; rejectionReason: string };
    };
    expect(upd.where.transferStatus).toBe(TransferStatus.RECEIVED);
    expect(upd.data).toMatchObject({
      transferStatus: TransferStatus.REJECTED,
      rejectionReason: 'Leaked',
    });
  });

  it('repeat from ACCEPTED returns each receiving copy to the sender', async () => {
    const { svc, samples } = setup(
      { transferStatus: TransferStatus.ACCEPTED },
      { copies: [{ id: 'copy1' }] },
    );
    await svc.repeatTransfer(['tr1'], TENANT, PERSON, 'B', {
      repeatReason: 'Clotted',
    });
    expect(samples.returnCopyToOrigin).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      PERSON,
      'copy1',
      'Clotted',
    );
    expect(samples.transitionInTx).not.toHaveBeenCalled();
    expect(samples.notifySamplesRepeated).toHaveBeenCalledWith(TENANT, ['sA']);
  });

  it('repeat from ACCEPTED fails when the receiving copy cannot be found', async () => {
    const { svc } = setup(
      { transferStatus: TransferStatus.ACCEPTED },
      { copies: [] },
    );
    await expect(
      svc.repeatTransfer(['tr1'], TENANT, PERSON, 'B', {
        repeatReason: 'x',
      }),
    ).rejects.toThrow();
  });

  it('reject from ACCEPTED returns the receiving copy to the sender - and never pre-unwinds the clone', async () => {
    // The accept created a copy (clonedSampleId). Our design owns this wind-down:
    // returnCopyToOrigin voids the copy, refuses when a report there has a validated
    // result, and resets/returns the report. Main's separate clone pre-unwind must
    // NOT run first (it would void the copy, and returnToSender would then find none).
    const { svc, samples, tx } = setup(
      { transferStatus: TransferStatus.ACCEPTED, clonedSampleId: 'copy1' },
      { copies: [{ id: 'copy1' }] },
    );
    await svc.reject(['tr1'], TENANT, PERSON, 'B', {
      rejectionReason: 'Leaked',
    });
    expect(samples.removeTransferCloneInTx).not.toHaveBeenCalled();
    expect(samples.returnCopyToOrigin).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      PERSON,
      'copy1',
      'Leaked',
    );
    expect(samples.transitionInTx).not.toHaveBeenCalled();
    expect(samples.notifySamplesRepeated).toHaveBeenCalledWith(TENANT, ['sA']);
    const upd = (
      tx.sampleTransfer.updateMany.mock.calls[0] as unknown[]
    )[0] as {
      where: { transferStatus: TransferStatus };
      data: { transferStatus: TransferStatus; clonedSampleId?: string | null };
    };
    expect(upd.where.transferStatus).toBe(TransferStatus.ACCEPTED);
    expect(upd.data.transferStatus).toBe(TransferStatus.REJECTED);
    // the link to the (now voided) copy is cleared
    expect(upd.data.clonedSampleId).toBeNull();
  });

  it('reject from ACCEPTED is refused when a report at the receiver is validated (nothing is changed)', async () => {
    const { svc, samples, tx } = setup(
      { transferStatus: TransferStatus.ACCEPTED, clonedSampleId: 'copy1' },
      { copies: [{ id: 'copy1' }] },
    );
    samples.returnCopyToOrigin.mockRejectedValue(
      new Error('SAMPLE_RETURN_BLOCKED'),
    );
    await expect(
      svc.reject(['tr1'], TENANT, PERSON, 'B', { rejectionReason: 'x' }),
    ).rejects.toThrow('SAMPLE_RETURN_BLOCKED');
    expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    expect(samples.notifySamplesRepeated).not.toHaveBeenCalled();
  });

  it('with skipInvalid a transfer that cannot take the action is reported as skipped, not thrown', async () => {
    const { svc } = setup({ transferStatus: TransferStatus.IN_TRANSIT });
    const result = await svc.reject(
      ['tr1'],
      TENANT,
      PERSON,
      'B',
      { rejectionReason: 'x' },
      true,
    );
    expect(result.succeeded).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ id: 'tr1' });
    expect(result.skipped[0]!.reason).toContain('"reject"');
  });

  describe('a group "skip invalid" Reject/Repeat does not fail as a whole', () => {
    /** The raw SQL statements run inside the transaction, in order (savepoints). */
    const sqlOf = (tx: { $executeRaw: jest.Mock }) =>
      tx.$executeRaw.mock.calls.map((c: unknown[]) =>
        (c[0] as string[]).join('').trim(),
      );

    it('skips a transfer whose report at the receiver is validated, changes nothing for it and rolls back to the savepoint', async () => {
      const { svc, samples, tx } = setup(
        { transferStatus: TransferStatus.ACCEPTED, clonedSampleId: 'copy1' },
        { copies: [{ id: 'copy1' }] },
      );
      samples.returnCopyToOrigin.mockRejectedValue(
        new SampleReturnBlockedException(SampleStatus.ACCEPTED),
      );
      const result = await svc.reject(
        ['tr1'],
        TENANT,
        PERSON,
        'B',
        { rejectionReason: 'x' },
        true,
      );
      expect(result.succeeded).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({ id: 'tr1' });
      expect(result.skipped[0]!.reason).toContain('already done');
      expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
      expect(samples.notifySamplesRepeated).not.toHaveBeenCalled();
      expect(sqlOf(tx)).toEqual([
        'SAVEPOINT return_to_sender',
        'ROLLBACK TO SAVEPOINT return_to_sender',
        'RELEASE SAVEPOINT return_to_sender',
      ]);
    });

    it('also skips a transfer whose copy has already been passed on to another branch', async () => {
      const { svc, samples, tx } = setup(
        { transferStatus: TransferStatus.ACCEPTED, clonedSampleId: 'copy1' },
        { copies: [{ id: 'copy1' }] },
      );
      samples.returnCopyToOrigin.mockRejectedValue(
        new SampleSentToBranchException('repeat', SampleStatus.SENT_INTERNAL),
      );
      const result = await svc.repeatTransfer(
        ['tr1'],
        TENANT,
        PERSON,
        'B',
        { repeatReason: 'x' },
        true,
      );
      expect(result.succeeded).toEqual([]);
      expect(result.skipped[0]!.reason).toContain('sent to another branch');
      expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    });

    it('the other transfers of the group still go through', async () => {
      const { svc, samples, tx } = setup(
        { transferStatus: TransferStatus.ACCEPTED },
        {},
      );
      tx.sampleTransfer.findFirst.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve({
            id: where.id,
            sampleId: where.id === 'tr1' ? 'sA' : 'sB',
            kind: TransferKind.INTERNAL,
            transferStatus: TransferStatus.ACCEPTED,
            destinationBranchId: 'B',
            receiveCondition: null,
            clonedSampleId: null,
          }),
      );
      tx.orderSample.findMany.mockImplementation(
        ({ where }: { where: { sourceTransferId: string } }) =>
          Promise.resolve([{ id: `copy-${where.sourceTransferId}` }]),
      );
      samples.returnCopyToOrigin
        .mockRejectedValueOnce(
          new SampleReturnBlockedException(SampleStatus.ACCEPTED),
        )
        .mockResolvedValueOnce('sB');
      const result = await svc.reject(
        ['tr1', 'tr2'],
        TENANT,
        PERSON,
        'B',
        { rejectionReason: 'x' },
        true,
      );
      expect(result.skipped.map((x) => x.id)).toEqual(['tr1']);
      expect(result.succeeded).toHaveLength(1);
      // only the second transfer was written, and its sender sample is notified
      expect(tx.sampleTransfer.updateMany).toHaveBeenCalledTimes(1);
      expect(
        (
          tx.sampleTransfer.updateMany.mock.calls[0] as [
            { where: { id: string } },
          ]
        )[0].where.id,
      ).toBe('tr2');
      expect(samples.notifySamplesRepeated).toHaveBeenCalledWith(TENANT, [
        'sB',
      ]);
      expect(sqlOf(tx)).toEqual([
        'SAVEPOINT return_to_sender',
        'ROLLBACK TO SAVEPOINT return_to_sender',
        'RELEASE SAVEPOINT return_to_sender',
        'SAVEPOINT return_to_sender',
        'RELEASE SAVEPOINT return_to_sender',
      ]);
    });

    it('without skip-invalid the refusal is still raised (strict action), and no savepoint is used', async () => {
      const { svc, samples, tx } = setup(
        { transferStatus: TransferStatus.ACCEPTED, clonedSampleId: 'copy1' },
        { copies: [{ id: 'copy1' }] },
      );
      samples.returnCopyToOrigin.mockRejectedValue(
        new SampleReturnBlockedException(SampleStatus.ACCEPTED),
      );
      await expect(
        svc.reject(['tr1'], TENANT, PERSON, 'B', { rejectionReason: 'x' }),
      ).rejects.toBeInstanceOf(SampleReturnBlockedException);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    });

    it('an error that is NOT a refusal (e.g. the copy is missing) is never swallowed, even when skipping', async () => {
      const { svc, tx } = setup(
        { transferStatus: TransferStatus.ACCEPTED },
        { copies: [] },
      );
      await expect(
        svc.reject(
          ['tr1'],
          TENANT,
          PERSON,
          'B',
          { rejectionReason: 'x' },
          true,
        ),
      ).rejects.toThrow();
      expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    });
  });

  it('does not touch samples for an EXTERNAL transfer', async () => {
    const { svc, samples } = setup({ kind: TransferKind.EXTERNAL });
    await svc.reject(['tr1'], TENANT, PERSON, 'B', {
      rejectionReason: 'x',
    });
    expect(samples.transitionInTx).not.toHaveBeenCalled();
    expect(samples.returnCopyToOrigin).not.toHaveBeenCalled();
    expect(samples.notifySamplesRepeated).not.toHaveBeenCalled();
  });

  it('refuses when a concurrent change already moved the transfer', async () => {
    const { svc } = setup({}, { updateCount: 0 });
    await expect(
      svc.reject(['tr1'], TENANT, PERSON, 'B', { rejectionReason: 'x' }),
    ).rejects.toThrow(InvalidTransferTransitionException);
  });
});

describe('SampleTransferService — assign center window', () => {
  it.each([
    TransferStatus.RECEIVED,
    TransferStatus.ACCEPTED,
    TransferStatus.REPEAT,
  ])('is refused for an INTERNAL transfer in %s', async (status) => {
    const { svc } = setup({ transferStatus: status });
    await expect(
      svc.assignCenter('tr1', TENANT, PERSON, {
        destinationBranchId: 'C',
      }),
    ).rejects.toThrow(TransferNotEditableException);
  });
});

describe('SampleTransferService - a cancelled order freezes its transfers', () => {
  it.each([
    ['pickUp', TransferStatus.IN_TRANSIT],
    ['receive', TransferStatus.PICKED_UP],
    ['accept', TransferStatus.RECEIVED],
  ] as const)(
    'the forward step %s is refused and nothing is written',
    async (method, status) => {
      const { svc, tx, samples } = setup({ transferStatus: status });
      samples.isOrderCancelled.mockResolvedValue(true);
      const call = (
        svc as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
      )[method]!.bind(svc);
      await expect(
        call(['tr1'], TENANT, PERSON, 'B', {}),
      ).rejects.toBeInstanceOf(TransferOrderCancelledException);
      expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
      expect(samples.transitionInTx).not.toHaveBeenCalled();
      expect(samples.returnCopyToOrigin).not.toHaveBeenCalled();
    },
  );

  describe('the wind-down by the receiving branch stays open', () => {
    it('Reject of a received sample is NOT refused (the sample goes back to the sender)', async () => {
      const { svc, tx, samples } = setup({
        transferStatus: TransferStatus.RECEIVED,
      });
      samples.isOrderCancelled.mockResolvedValue(true);
      await svc.reject(['tr1'], TENANT, PERSON, 'B', {
        rejectionReason: 'Cancelled',
      });
      expect(samples.isOrderCancelled).not.toHaveBeenCalled();
      expect(samples.transitionInTx).toHaveBeenCalledTimes(1);
      expect(tx.sampleTransfer.updateMany).toHaveBeenCalled();
    });

    it('Repeat of an accepted copy is NOT refused (the copy goes back to the sender)', async () => {
      const { svc, tx, samples } = setup(
        { transferStatus: TransferStatus.ACCEPTED },
        { copies: [{ id: 'copy1' }] },
      );
      samples.isOrderCancelled.mockResolvedValue(true);
      await svc.repeatTransfer(['tr1'], TENANT, PERSON, 'B', {
        repeatReason: 'Cancelled',
      });
      expect(samples.isOrderCancelled).not.toHaveBeenCalled();
      expect(tx.sampleTransfer.updateMany).toHaveBeenCalled();
    });
  });

  describe('Accept takes the order row before it re-checks (cancel vs accept race)', () => {
    it('locks the order row FOR SHARE first, then asks whether it is cancelled', async () => {
      const { svc, tx, samples } = setup({
        transferStatus: TransferStatus.RECEIVED,
      });
      const order: string[] = [];
      tx.$queryRaw.mockImplementation((...a: unknown[]) => {
        order.push('lock');
        const sql = (a[0] as string[]).join('?');
        expect(sql).toContain('FROM orders');
        expect(sql).toContain('FOR SHARE');
        return Promise.resolve([]);
      });
      samples.isOrderCancelled.mockImplementation(() => {
        order.push('check');
        return Promise.resolve(true);
      });
      await expect(
        svc.accept(['tr1'], TENANT, PERSON, 'B', {}),
      ).rejects.toBeInstanceOf(TransferOrderCancelledException);
      expect(order).toEqual(['lock', 'check']);
    });

    it.each([
      ['pickUp', TransferStatus.IN_TRANSIT],
      ['receive', TransferStatus.PICKED_UP],
    ] as const)(
      '%s does not take the lock (it creates nothing)',
      async (method, status) => {
        const { svc, tx } = setup({ transferStatus: status });
        await (
          svc as unknown as Record<
            string,
            (...a: unknown[]) => Promise<unknown>
          >
        )[method]!(['tr1'], TENANT, PERSON, 'B', {});
        expect(tx.$queryRaw).not.toHaveBeenCalled();
      },
    );

    it('Reject and Repeat (the wind-down) do not take it either', async () => {
      const a = setup({ transferStatus: TransferStatus.RECEIVED });
      await a.svc.reject(['tr1'], TENANT, PERSON, 'B', {
        rejectionReason: 'x',
      });
      expect(a.tx.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it('asks about the order of the transfer sample', async () => {
    const { svc, samples, tx } = setup({
      transferStatus: TransferStatus.PICKED_UP,
    });
    samples.isOrderCancelled.mockResolvedValue(true);
    await svc
      .receive(['tr1'], TENANT, PERSON, 'B', {} as never)
      .catch(() => undefined);
    expect(tx.orderSample.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sA', tenantId: TENANT } }),
    );
    expect(samples.isOrderCancelled).toHaveBeenCalledWith(tx, TENANT, 'o1');
  });

  it('an order that is not cancelled goes on to the normal transfer step', async () => {
    const { svc, tx } = setup({ transferStatus: TransferStatus.PICKED_UP });
    await svc.receive(['tr1'], TENANT, PERSON, 'B', {} as never);
    expect(tx.sampleTransfer.updateMany).toHaveBeenCalled();
  });

  it('assign center is refused too', async () => {
    const { svc, samples } = setup({
      transferStatus: TransferStatus.IN_TRANSIT,
    });
    samples.isOrderCancelled.mockResolvedValue(true);
    await expect(
      svc.assignCenter('tr1', TENANT, PERSON, { destinationBranchId: 'C' }),
    ).rejects.toBeInstanceOf(TransferOrderCancelledException);
  });
});

describe('SampleTransferService — transfer with no destination', () => {
  it.each([
    ['pickUp', TransferStatus.IN_TRANSIT],
    ['receive', TransferStatus.PICKED_UP],
    ['accept', TransferStatus.RECEIVED],
  ] as const)(
    '%s is refused for an INTERNAL transfer nobody was addressed to',
    async (method, status) => {
      const { svc, tx } = setup({
        transferStatus: status,
        destinationBranchId: null,
      });
      const call =
        method === 'receive'
          ? svc.receive(['tr1'], TENANT, PERSON, 'B', {
              receiveCondition: 'ok',
            })
          : svc[method](['tr1'], TENANT, PERSON, 'B', {});
      await expect(call).rejects.toThrow(TransferDestinationMissingException);
      expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    },
  );

  it('an EXTERNAL transfer (no branch destination by design) is not affected', async () => {
    const { svc } = setup({
      kind: TransferKind.EXTERNAL,
      transferStatus: TransferStatus.IN_TRANSIT,
      destinationBranchId: null,
    });
    await expect(
      svc.pickUp(['tr1'], TENANT, PERSON, 'B', {}),
    ).resolves.toBeDefined();
  });
});

describe('SampleTransferService — assign center to a previous holder', () => {
  it('refuses a destination that already held the sample', async () => {
    const { svc, prisma, transfer } = setup({
      transferStatus: TransferStatus.IN_TRANSIT,
    });
    (transfer as unknown as { sample: Record<string, unknown> }).sample = {
      status: 'SENT_INTERNAL',
      branchId: 'B',
      originBranchId: 'A',
      heldBranchIds: ['A', 'B'],
    };
    (svc as unknown as { branches: unknown }).branches = {
      findById: jest.fn().mockResolvedValue({}),
    };
    prisma.sampleTransfer.findFirst.mockResolvedValue(transfer);
    await expect(
      svc.assignCenter('tr1', TENANT, PERSON, { destinationBranchId: 'A' }),
    ).rejects.toThrow(SendBlockedException);
  });
});

describe('SampleTransferService — accept clones the sample into the receiving branch', () => {
  function accept() {
    const source = {
      id: 'sA',
      branchId: 'A',
      originBranchId: 'A',
      orderId: 'o1',
      labTestId: 'lt1',
      labTestSampleId: 'lts1',
      departmentId: 'd1',
      sampleType: 'Blood',
      containerType: 'Serum tube',
      sampleGroupLabel: 'G1',
      sampleName: 'Fasting blood',
      priority: 'NORMAL',
      barcode: 'BC-1',
      orderIdBarcode: 'OB-1',
      heldBranchIds: [],
      tests: [{ orderItemId: 'i1', labTestId: 'lt1', testName: 'CBC' }],
    };
    const create = jest.fn().mockResolvedValue({ id: 'copy1' });
    const tx = {
      orderSample: {
        findFirst: jest.fn().mockResolvedValue(source),
        create,
      },
      tenant: {
        update: jest.fn().mockResolvedValue({ accessionCounter: 7 }),
      },
    };
    const samples = {
      ensureLabReportsForAcceptedSample: jest.fn().mockResolvedValue(undefined),
      rehomeLabReportsForSample: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new SampleTransferService(
      {} as never,
      samples as never,
      {} as never,
      {} as never,
    );
    const done = (
      svc as unknown as {
        cloneIntoDestination: (...a: unknown[]) => Promise<void>;
      }
    ).cloneIntoDestination(tx, TENANT, PERSON, {
      id: 'tr1',
      kind: TransferKind.INTERNAL,
      sampleId: 'sA',
      destinationBranchId: 'B',
      receiveCondition: null,
    });
    return { done, create, samples };
  }

  it('the copy keeps the sample name and the tube barcode of the original', async () => {
    const { done, create } = accept();
    await done;
    const data = (
      create.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({
      branchId: 'B',
      sampleName: 'Fasting blood',
      barcode: 'BC-1',
      orderIdBarcode: 'OB-1',
      sourceTransferId: 'tr1',
    });
  });

  it('moves the report only from the sending branch (a report already elsewhere stays)', async () => {
    const { done, samples } = accept();
    await done;
    expect(samples.rehomeLabReportsForSample).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      'copy1',
      'B',
      'A', // the sender's branch
    );
  });
});

describe('SampleTransferService - only the receiving branch works an INTERNAL transfer', () => {
  // Transfer addressed to branch B (sent by A). Each action in a state where it is legal.
  const ACTIONS = [
    ['pickUp', TransferStatus.IN_TRANSIT],
    ['receive', TransferStatus.PICKED_UP],
    ['accept', TransferStatus.RECEIVED],
    ['reject', TransferStatus.RECEIVED],
    ['repeatTransfer', TransferStatus.RECEIVED],
  ] as const;

  function run(
    svc: ReturnType<typeof setup>['svc'],
    method: (typeof ACTIONS)[number][0],
    actingBranchId: string | null,
    skipInvalid = false,
  ) {
    const ids = ['tr1'];
    switch (method) {
      case 'pickUp':
        return svc.pickUp(ids, TENANT, PERSON, actingBranchId, {}, skipInvalid);
      case 'receive':
        return svc.receive(
          ids,
          TENANT,
          PERSON,
          actingBranchId,
          { receiveCondition: 'ok' },
          skipInvalid,
        );
      case 'accept':
        return svc.accept(ids, TENANT, PERSON, actingBranchId, {}, skipInvalid);
      case 'reject':
        return svc.reject(
          ids,
          TENANT,
          PERSON,
          actingBranchId,
          { rejectionReason: 'x' },
          skipInvalid,
        );
      case 'repeatTransfer':
        return svc.repeatTransfer(
          ids,
          TENANT,
          PERSON,
          actingBranchId,
          { repeatReason: 'x' },
          skipInvalid,
        );
    }
  }

  describe.each(ACTIONS)('%s', (method, status) => {
    it.each([
      ['the sending branch', 'A'],
      ['an uninvolved branch', 'C'],
      ['a caller with no active branch (business admin)', null],
    ])('is refused for %s, and nothing is touched', async (_who, branch) => {
      const { svc, tx, samples } = setup({ transferStatus: status });
      await expect(run(svc, method, branch)).rejects.toBeInstanceOf(
        TransferWrongBranchException,
      );
      expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
      expect(samples.transitionInTx).not.toHaveBeenCalled();
      expect(samples.returnCopyToOrigin).not.toHaveBeenCalled();
    });

    it('is still refused as a whole inside a "skip invalid" group action (never skipped)', async () => {
      const { svc, tx } = setup({ transferStatus: status });
      await expect(run(svc, method, 'A', true)).rejects.toBeInstanceOf(
        TransferWrongBranchException,
      );
      expect(tx.sampleTransfer.updateMany).not.toHaveBeenCalled();
    });

    // Accept builds a whole copy of the sample; its success path is covered by the
    // "accept clones the sample" tests below, which already act as branch B.
    if (method !== 'accept') {
      it('works for the receiving branch (B)', async () => {
        const { svc } = setup({ transferStatus: status });
        await expect(run(svc, method, 'B')).resolves.toBeDefined();
      });
    }
  });

  it('the refusal is a 403 with a readable message that names the receiving role', async () => {
    const { svc } = setup({ transferStatus: TransferStatus.IN_TRANSIT });
    const err = await run(svc, 'pickUp', 'A').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransferWrongBranchException);
    const e = err as TransferWrongBranchException;
    expect(e.getStatus()).toBe(403);
    expect(JSON.stringify(e.getResponse())).toContain('TRANSFER_WRONG_BRANCH');
    expect(JSON.stringify(e.getResponse())).toContain(
      'Switch to the receiving branch',
    );
  });

  it('a group action with one wrong-branch transfer touches none of them', async () => {
    const { svc, tx } = setup({ transferStatus: TransferStatus.IN_TRANSIT });
    tx.sampleTransfer.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          sampleId: where.id,
          kind: TransferKind.INTERNAL,
          transferStatus: TransferStatus.IN_TRANSIT,
          destinationBranchId: where.id === 'mine' ? 'B' : 'C',
          receiveCondition: null,
        }),
    );
    await expect(
      svc.pickUp(['mine', 'foreign'], TENANT, PERSON, 'B', {}, true),
    ).rejects.toBeInstanceOf(TransferWrongBranchException);
  });

  it('an EXTERNAL transfer has no destination branch and is not branch-checked', async () => {
    const { svc } = setup({
      kind: TransferKind.EXTERNAL,
      transferStatus: TransferStatus.IN_TRANSIT,
      destinationBranchId: null,
    });
    await expect(
      svc.pickUp(['tr1'], TENANT, PERSON, 'Z', {}),
    ).resolves.toBeDefined();
  });

  describe('Assign Center belongs to the sending branch', () => {
    function withSender(senderBranch: string) {
      const ctx = setup({ transferStatus: TransferStatus.IN_TRANSIT });
      ctx.prisma.sampleTransfer.findFirst.mockResolvedValue({
        ...ctx.transfer,
        branchId: senderBranch,
        sample: {},
      });
      return ctx;
    }
    it.each([
      ['the receiving branch', 'B'],
      ['an uninvolved branch', 'C'],
      ['a caller with no active branch', null],
    ])('is refused for %s', async (_who, branch) => {
      const { svc } = withSender('A');
      await expect(
        svc.assignCenter(
          'tr1',
          TENANT,
          PERSON,
          { destinationBranchId: 'D' },
          { branchId: branch, profileKey: 'doctor' },
        ),
      ).rejects.toBeInstanceOf(TransferWrongBranchException);
    });
  });
});
