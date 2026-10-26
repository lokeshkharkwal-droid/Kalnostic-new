import { TransferKind, TransferStatus } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import {
  CenterChangesBusyException,
  CenterChangesRefusedException,
  TransferNotEditableException,
  TransferWrongBranchException,
} from './exceptions/accession.exceptions';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';

/**
 * The Assign / Edit Center dialog's Confirm as ONE all-or-nothing request. Here the
 * orchestration is tested (permissions, naming the failing tube, the single
 * transaction, retrieves before center changes); the per-tube checks themselves are
 * the existing Assign Center rules (spied), and the real rollback is proven in the
 * end-to-end spec.
 */
const ACTOR = {
  branchId: 'A',
  profileKey: 'accession_manager',
  roleKey: 'accession_manager',
  roleLabel: 'Accession Manager',
};

function setup() {
  const order: string[] = [];
  const tx = {
    sampleTransfer: {
      findFirst: jest.fn().mockResolvedValue({ id: 'open' }),
    },
    orderSample: {
      findFirst: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve({ accessionNo: `ACC-${args.where.id}` }),
      ),
    },
  };
  const prisma = {
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    sampleTransfer: {
      findFirst: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve({ sample: { accessionNo: `ACC-${args.where.id}` } }),
      ),
    },
  };
  const samples = {
    retrieveOneInTx: jest.fn(
      (
        _tx: unknown,
        _t: string,
        _p: string,
        _b: string,
        id: string,
        ..._rest: unknown[]
      ) => {
        order.push(`retrieve:${id}`);
        return Promise.resolve();
      },
    ),
  };
  const permissionCheck = { assertAny: jest.fn().mockResolvedValue(undefined) };
  const svc = new SampleTransferService(
    prisma as never,
    samples as never,
    {} as never,
    permissionCheck as never,
  );
  const priv = svc as unknown as {
    prepareCenterChange: jest.Mock;
    persistCenterChange: jest.Mock;
  };
  priv.prepareCenterChange = jest.fn(
    (
      transferId: string,
      _t: string,
      _p: string,
      dto: Record<string, unknown>,
    ) =>
      Promise.resolve({
        transferId,
        transfer: {
          kind: TransferKind.INTERNAL,
          transferStatus: TransferStatus.IN_TRANSIT,
          sampleId: `smp-${transferId}`,
        },
        dto,
        data: {},
      }),
  );
  priv.persistCenterChange = jest.fn(
    (_tx: unknown, _t: string, _p: string, p: { transferId: string }) => {
      order.push(`change:${p.transferId}`);
      return Promise.resolve();
    },
  );
  return { svc, tx, prisma, samples, permissionCheck, priv, order };
}

const run = (svc: SampleTransferService, dto: Record<string, unknown>) =>
  svc.applyCenterChanges('t1', 'p1', dto, ACTOR);

describe('SampleTransferService.applyCenterChanges', () => {
  it('refuses an empty request and a transfer listed twice', async () => {
    const { svc } = setup();
    await expect(run(svc, {})).rejects.toBeInstanceOf(ValidationException);
    await expect(
      run(svc, {
        changes: [
          { transferId: 'x', destinationBranchId: 'B' },
          { transferId: 'x', destinationBranchId: 'C' },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('each ticked tube gets its OWN center, and the shared logistics ride along', async () => {
    const { svc, priv } = setup();
    await run(svc, {
      changes: [
        { transferId: 't-b', destinationBranchId: 'B' },
        { transferId: 't-c', destinationBranchId: 'C' },
      ],
      logisticsType: 'Courier',
      sendTime: '10:30',
    });
    const dtos = (priv.prepareCenterChange.mock.calls as unknown[][]).map(
      (c) => c[3] as Record<string, unknown>,
    );
    expect(dtos[0]).toMatchObject({
      destinationBranchId: 'B',
      logisticsType: 'Courier',
      sendTime: '10:30',
    });
    expect(dtos[1]).toMatchObject({
      destinationBranchId: 'C',
      logisticsType: 'Courier',
      sendTime: '10:30',
    });
  });

  it('everything is written in ONE transaction, retrieves first, then the center changes', async () => {
    const { svc, prisma, order, samples } = setup();
    const out = await run(svc, {
      changes: [
        { transferId: 't1', destinationBranchId: 'B' },
        { transferId: 't2', destinationBranchId: 'C' },
      ],
      retrieveSampleIds: ['s9', 's3'],
    });
    expect(prisma.withTenant).toHaveBeenCalledTimes(1);
    // retrieves in a fixed (sorted) order so overlapping requests cannot deadlock
    expect(order).toEqual([
      'retrieve:s3',
      'retrieve:s9',
      'change:t1',
      'change:t2',
    ]);
    expect(out).toEqual({ changed: 2, retrieved: 2 });
    // the acting user's role goes to the audit entries of the retrieves
    expect(samples.retrieveOneInTx.mock.calls[0]![6]).toEqual({
      roleKey: 'accession_manager',
      roleLabel: 'Accession Manager',
    });
  });

  it('un-ticking needs the Retrieve permission; a request that only changes centers does not ask for it', async () => {
    const withRetrieve = setup();
    await run(withRetrieve.svc, { retrieveSampleIds: ['s1'] });
    expect(withRetrieve.permissionCheck.assertAny).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: 'A',
        profileKey: 'accession_manager',
      }),
      [PERMISSION_KEYS.ACC_IH_RETRIEVE],
    );
    const onlyChanges = setup();
    await run(onlyChanges.svc, {
      changes: [{ transferId: 't1', destinationBranchId: 'B' }],
    });
    expect(onlyChanges.permissionCheck.assertAny).not.toHaveBeenCalled();
  });

  it('a missing Retrieve permission stops everything before anything is written', async () => {
    const { svc, permissionCheck, prisma } = setup();
    permissionCheck.assertAny.mockRejectedValue(new Error('403'));
    await expect(
      run(svc, {
        changes: [{ transferId: 't1', destinationBranchId: 'B' }],
        retrieveSampleIds: ['s1'],
      }),
    ).rejects.toThrow('403');
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });

  it('a tube that fails its check refuses the WHOLE request, names the tube, and nothing is written', async () => {
    const { svc, priv, prisma } = setup();
    priv.prepareCenterChange.mockImplementation((transferId: string) =>
      transferId === 't2'
        ? Promise.reject(
            new TransferNotEditableException('t2', TransferStatus.RECEIVED),
          )
        : Promise.resolve({
            transferId,
            transfer: {
              kind: TransferKind.INTERNAL,
              sampleId: `smp-${transferId}`,
            },
            dto: {},
            data: {},
          }),
    );
    const err = (await run(svc, {
      changes: [
        { transferId: 't1', destinationBranchId: 'B' },
        { transferId: 't2', destinationBranchId: 'B' },
      ],
    }).catch((e: unknown) => e)) as CenterChangesRefusedException;
    expect(err).toBeInstanceOf(CenterChangesRefusedException);
    expect(err.errorCode).toBe('CENTER_CHANGES_REFUSED');
    const body = err.getResponse() as { error: { message: string } };
    expect(body.error.message).toContain('Nothing was changed.');
    expect(body.error.message).toContain('ACC-t2');
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });

  it('a receiving branch that received a tube in the meantime (the write is refused inside the transaction) refuses the whole request, naming that tube', async () => {
    const { svc, priv } = setup();
    priv.persistCenterChange.mockImplementation(
      (_tx: unknown, _t: string, _p: string, p: { transferId: string }) =>
        p.transferId === 't2'
          ? Promise.reject(
              new TransferNotEditableException('t2', TransferStatus.RECEIVED),
            )
          : Promise.resolve(),
    );
    const err = (await run(svc, {
      changes: [
        { transferId: 't1', destinationBranchId: 'B' },
        { transferId: 't2', destinationBranchId: 'B' },
      ],
    }).catch((e: unknown) => e)) as CenterChangesRefusedException;
    expect(err).toBeInstanceOf(CenterChangesRefusedException);
    expect(
      (err.getResponse() as { error: { message: string } }).error.message,
    ).toContain('ACC-smp-t2');
  });

  it('a tube that cannot be retrieved (wrong branch, already received...) refuses the whole request', async () => {
    const { svc, samples, priv } = setup();
    samples.retrieveOneInTx.mockImplementation(
      (_tx: unknown, _t: string, _p: string, _b: string, id: string) =>
        id === 's2'
          ? Promise.reject(
              new TransferWrongBranchException('s2', 'retrieve', 'sender'),
            )
          : Promise.resolve(),
    );
    const err = (await run(svc, { retrieveSampleIds: ['s1', 's2'] }).catch(
      (e: unknown) => e,
    )) as CenterChangesRefusedException;
    expect(err).toBeInstanceOf(CenterChangesRefusedException);
    expect(
      (err.getResponse() as { error: { message: string } }).error.message,
    ).toContain('ACC-s2');
    expect(priv.persistCenterChange).not.toHaveBeenCalled();
  });

  it('only a tube still waiting at another branch can be retrieved here: no open transfer refuses the request', async () => {
    const { svc, tx, samples } = setup();
    tx.sampleTransfer.findFirst.mockResolvedValue(null);
    const err = (await run(svc, { retrieveSampleIds: ['s1'] }).catch(
      (e: unknown) => e,
    )) as CenterChangesRefusedException;
    expect(err).toBeInstanceOf(CenterChangesRefusedException);
    expect(
      (err.getResponse() as { error: { message: string } }).error.message,
    ).toContain('not waiting at another branch');
    expect(samples.retrieveOneInTx).not.toHaveBeenCalled();
  });

  it('a tube cannot be retrieved AND have its center changed in the same request', async () => {
    const { svc } = setup();
    await expect(
      run(svc, {
        changes: [{ transferId: 't1', destinationBranchId: 'B' }],
        retrieveSampleIds: ['smp-t1'],
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });
});

describe('SampleTransferService.applyCenterChanges - lock order and database errors', () => {
  it('works the tubes in ONE fixed order (ascending sample id), retrieves and changes together, whatever order the dialog listed them', async () => {
    const { svc, order } = setup();
    await run(svc, {
      changes: [
        { transferId: 'x2', destinationBranchId: 'B' },
        { transferId: 'x1', destinationBranchId: 'B' },
      ],
      retrieveSampleIds: ['smp-x3', 'smp-x0'],
    });
    expect(order).toEqual([
      'retrieve:smp-x0',
      'change:x1',
      'change:x2',
      'retrieve:smp-x3',
    ]);
  });

  it('the same two tubes listed in OPPOSITE order by two requests are worked in the SAME order (no deadlock between them)', async () => {
    const a = setup();
    const b = setup();
    await run(a.svc, {
      changes: [
        { transferId: 'x1', destinationBranchId: 'B' },
        { transferId: 'x2', destinationBranchId: 'B' },
      ],
    });
    await run(b.svc, {
      changes: [
        { transferId: 'x2', destinationBranchId: 'B' },
        { transferId: 'x1', destinationBranchId: 'B' },
      ],
    });
    expect(a.order).toEqual(['change:x1', 'change:x2']);
    expect(b.order).toEqual(a.order);
  });

  it('a database error in the middle of the batch is passed on as it is: no further query runs inside the aborted transaction', async () => {
    const { svc, tx, priv } = setup();
    const boom = new Error('connection reset');
    priv.persistCenterChange.mockImplementationOnce(() => Promise.reject(boom));
    await expect(
      run(svc, {
        changes: [{ transferId: 'x1', destinationBranchId: 'B' }],
      }),
    ).rejects.toBe(boom);
    expect(tx.orderSample.findFirst).not.toHaveBeenCalled();
  });

  it('a deadlock / write conflict from the database is reported as "someone else is changing these tubes, try again" (409), not a 500', async () => {
    const { svc, priv } = setup();
    priv.persistCenterChange.mockImplementationOnce(() =>
      Promise.reject(new Error('ERROR: deadlock detected (40P01)')),
    );
    const err = (await run(svc, {
      changes: [{ transferId: 'x1', destinationBranchId: 'B' }],
    }).catch((e: unknown) => e)) as CenterChangesBusyException;
    expect(err).toBeInstanceOf(CenterChangesBusyException);
    expect(err.getStatus()).toBe(409);
    expect((err.getResponse() as { error: { code: string } }).error.code).toBe(
      'CENTER_CHANGES_BUSY',
    );
  });

  it('a refusal the service itself raises still names the tube', async () => {
    const { svc, priv } = setup();
    priv.persistCenterChange.mockImplementationOnce(() =>
      Promise.reject(
        new TransferNotEditableException('x1', TransferStatus.RECEIVED),
      ),
    );
    const err = (await run(svc, {
      changes: [{ transferId: 'x1', destinationBranchId: 'B' }],
    }).catch((e: unknown) => e)) as CenterChangesRefusedException;
    expect(err).toBeInstanceOf(CenterChangesRefusedException);
    expect(
      (err.getResponse() as { error: { message: string } }).error.message,
    ).toContain('ACC-smp-x1');
  });
});
