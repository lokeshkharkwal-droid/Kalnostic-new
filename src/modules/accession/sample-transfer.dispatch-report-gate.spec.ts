import { SampleStatus, TransferKind } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import { SendBlockedException } from './exceptions/accession.exceptions';

/**
 * Forward and Outsource are refused for a sample whose report has been worked on, exactly like a
 * Send to another branch. A group call with "skip invalid" skips that sample with the reason.
 */
function setup(refuse: boolean) {
  const created: Record<string, unknown>[] = [];
  const tx = {
    sampleTransfer: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({ id: 'tNew' });
      }),
    },
    orderSample: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 's1', accessionNo: 'ACC-1', status: SampleStatus.ACCEPTED },
        ]),
    },
  };
  const prisma = {
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    sampleTransfer: { findFirst: jest.fn().mockResolvedValue({ id: 'tNew' }) },
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
    outsourceCenter: { findFirst: jest.fn().mockResolvedValue({ id: 'oc1' }) },
  };
  const samples = {
    assertInternalSendable: jest.fn().mockResolvedValue(undefined),
    assertDispatchable: jest.fn(() =>
      refuse
        ? Promise.reject(
            new SendBlockedException(
              SampleStatus.ACCEPTED,
              'The report for this test has already been worked on (results, notes or attachments exist, or it is past Pending), so the sample cannot be forwarded to a partner lab.',
              'forward',
            ),
          )
        : Promise.resolve(),
    ),
    transitionInTx: jest.fn().mockResolvedValue({
      id: 's1',
      branchId: 'A',
      status: SampleStatus.FORWARD_EXTERNAL,
    }),
  };
  const svc = new SampleTransferService(
    prisma as never,
    samples as never,
    {} as never,
    {} as never,
  );
  return { svc, samples, tx, created };
}

describe('SampleTransferService - Forward / Outsource need an untouched report', () => {
  it('Forward asks the check before it moves the sample, and goes through when the report is untouched', async () => {
    const { svc, samples, created } = setup(false);
    await svc.forward(['s1'], 't1', 'p1', { externalPartnerName: 'Lab X' });
    expect(samples.assertDispatchable).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      's1',
      'forward',
    );
    expect(samples.assertInternalSendable).not.toHaveBeenCalled();
    expect(created[0]).toMatchObject({ kind: TransferKind.EXTERNAL });
  });

  it('Outsource asks the check with its own action', async () => {
    const { svc, samples, created } = setup(false);
    await svc.outsource(['s1'], 't1', 'p1', { outsourceCenterId: 'oc1' });
    expect(samples.assertDispatchable).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      's1',
      'outsource',
    );
    expect(created[0]).toMatchObject({ kind: TransferKind.OUTSOURCE });
  });

  it('a worked-on report refuses a single Forward: nothing is moved or created', async () => {
    const { svc, samples, created } = setup(true);
    await expect(
      svc.forward(['s1'], 't1', 'p1', { externalPartnerName: 'Lab X' }),
    ).rejects.toMatchObject({ errorCode: 'SAMPLE_SEND_BLOCKED' });
    expect(samples.transitionInTx).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('a group Forward with skip invalid skips it, with the reason and the code', async () => {
    const { svc, samples, created } = setup(true);
    const r = await svc.forward(['s1'], 't1', 'p1', {
      externalPartnerName: 'Lab X',
      skipInvalid: true,
    });
    expect(r.succeeded).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({
      id: 's1',
      accessionNo: 'ACC-1',
      code: 'SAMPLE_SEND_BLOCKED',
    });
    expect(r.skipped[0]!.reason).toContain('cannot be forwarded');
    expect(samples.transitionInTx).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('a group Outsource with skip invalid skips it the same way', async () => {
    const { svc, created } = setup(true);
    const r = await svc.outsource(['s1'], 't1', 'p1', {
      outsourceCenterId: 'oc1',
      skipInvalid: true,
    });
    expect(r.skipped[0]).toMatchObject({ code: 'SAMPLE_SEND_BLOCKED' });
    expect(created).toHaveLength(0);
  });
});
