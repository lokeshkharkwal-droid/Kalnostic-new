import { TransferKind, TransferStatus } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import {
  InvalidTransferTransitionException,
  TransferDestinationMissingException,
  SendBlockedException,
  TransferNotEditableException,
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
    sampleTransfer: {
      findFirst: jest.fn().mockResolvedValue(transfer),
      updateMany: jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }),
    },
    orderSample: {
      findMany: jest.fn().mockResolvedValue(opts.copies ?? []),
    },
  };
  const prisma = {
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    sampleTransfer: { findFirst: jest.fn().mockResolvedValue(transfer) },
  };
  const samples = {
    transitionInTx: jest.fn().mockResolvedValue({}),
    returnCopyToOrigin: jest.fn().mockResolvedValue('sA'),
    notifySamplesRepeated: jest.fn().mockResolvedValue(undefined),
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
    await svc.reject(['tr1'], TENANT, PERSON, {
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
    await svc.repeatTransfer(['tr1'], TENANT, PERSON, {
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
      svc.repeatTransfer(['tr1'], TENANT, PERSON, {
        repeatReason: 'x',
      }),
    ).rejects.toThrow();
  });

  it('does not touch samples for an EXTERNAL transfer', async () => {
    const { svc, samples } = setup({ kind: TransferKind.EXTERNAL });
    await svc.reject(['tr1'], TENANT, PERSON, {
      rejectionReason: 'x',
    });
    expect(samples.transitionInTx).not.toHaveBeenCalled();
    expect(samples.returnCopyToOrigin).not.toHaveBeenCalled();
    expect(samples.notifySamplesRepeated).not.toHaveBeenCalled();
  });

  it('refuses when a concurrent change already moved the transfer', async () => {
    const { svc } = setup({}, { updateCount: 0 });
    await expect(
      svc.reject(['tr1'], TENANT, PERSON, { rejectionReason: 'x' }),
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
          ? svc.receive(['tr1'], TENANT, PERSON, { receiveCondition: 'ok' })
          : svc[method](['tr1'], TENANT, PERSON, {});
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
      svc.pickUp(['tr1'], TENANT, PERSON, {}),
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
    (prisma.sampleTransfer.findFirst as jest.Mock).mockResolvedValue(transfer);
    await expect(
      svc.assignCenter('tr1', TENANT, PERSON, { destinationBranchId: 'A' }),
    ).rejects.toThrow(SendBlockedException);
  });
});
