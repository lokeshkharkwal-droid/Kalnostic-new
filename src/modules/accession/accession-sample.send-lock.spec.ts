import { OrderSampleService } from './accession-sample.service';
import { SendBlockedException } from './exceptions/accession.exceptions';

/**
 * Send checks that the report is untouched. That check only means something if a
 * technician write that is still in flight cannot slip in after it, so the report
 * rows are locked first.
 */
function build(untouched: boolean) {
  const calls: string[] = [];
  const labReportService = {
    findReportIdsForSampleTests: jest.fn().mockResolvedValue(['r1', 'r2']),
    lockReports: jest.fn(() => {
      calls.push('lock');
      return Promise.resolve();
    }),
    isReportUntouched: jest.fn(() => {
      calls.push('check');
      return Promise.resolve(untouched);
    }),
  };
  const tx = {
    orderSample: {
      findFirst: jest.fn().mockResolvedValue({
        id: 's1',
        branchId: 'A',
        originBranchId: 'A',
        heldBranchIds: [],
        status: 'ACCEPTED',
        tests: [{ orderItemId: 'i1', labTestId: 'lt1' }],
      }),
    },
    sampleTransfer: { findFirst: jest.fn().mockResolvedValue(null) },
    // the destination (branch B) offers the tube's one test, so only the lock / report rules
    // under test here can refuse (the offer rule has its own spec: destination-offers.util.spec)
    orderSampleTest: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ labTestId: 'lt1', testName: 'Urine' }]),
    },
    labTest: {
      findMany: jest.fn((args: { where: { id?: unknown } }) =>
        Promise.resolve(
          args.where.id
            ? [{ id: 'lt1', sourceMasterLabTestId: 'T1' }]
            : [{ id: 'bt1', branchId: 'B', sourceMasterLabTestId: 'T1' }],
        ),
      ),
    },
    branchLabTest: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ branchId: 'B', sourceLabTestId: 'bt1' }]),
    },
    branch: { findFirst: jest.fn().mockResolvedValue({ name: 'B' }) },
  };
  const service = new OrderSampleService(
    {} as never,
    {} as never,
    labReportService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, tx, labReportService, calls };
}

describe('OrderSampleService.assertDispatchable - Forward / Outsource need an untouched report too', () => {
  it.each(['forward', 'outsource'] as const)(
    '%s: locks every report of the sample, then checks each is untouched',
    async (action) => {
      const { service, tx, labReportService, calls } = build(true);
      await service.assertDispatchable(tx as never, 't1', 's1', action);
      expect(labReportService.lockReports).toHaveBeenCalledWith(tx, 't1', [
        'r1',
        'r2',
      ]);
      expect(calls).toEqual(['lock', 'check', 'check']);
    },
  );

  it.each([
    ['forward', 'forwarded to a partner lab'],
    ['outsource', 'outsourced'],
  ] as const)(
    'a worked-on report blocks %s with a message that says why',
    async (action, outcome) => {
      const { service, tx, calls } = build(false);
      const err = await service
        .assertDispatchable(tx as never, 't1', 's1', action)
        .catch((e: unknown) => e as SendBlockedException);
      expect(err).toBeInstanceOf(SendBlockedException);
      expect((err as SendBlockedException).errorCode).toBe(
        'SAMPLE_SEND_BLOCKED',
      );
      const body = (err as SendBlockedException).getResponse() as {
        error: { message: string };
      };
      expect(body.error.message).toContain('has already been worked on');
      expect(body.error.message).toContain(`cannot be ${outcome}`);
      expect(calls[0]).toBe('lock');
    },
  );

  it('a missing sample is left for the transition to report (no lock, no error)', async () => {
    const { service, tx, labReportService } = build(true);
    tx.orderSample.findFirst.mockResolvedValue(null);
    await expect(
      service.assertDispatchable(tx as never, 't1', 'nope', 'forward'),
    ).resolves.toBeUndefined();
    expect(labReportService.lockReports).not.toHaveBeenCalled();
  });

  it('Send keeps its own wording ("sent to another branch")', async () => {
    const { service, tx } = build(false);
    const err = (await service
      .assertInternalSendable(tx as never, 't1', 's1', 'B')
      .catch((e: unknown) => e)) as SendBlockedException;
    const body = err.getResponse() as { error: { message: string } };
    expect(body.error.message).toContain('cannot be sent to another branch');
  });
});

describe('OrderSampleService.assertInternalSendable - locks before it checks', () => {
  it('locks every report of the sample, then checks each is untouched', async () => {
    const { service, tx, labReportService, calls } = build(true);
    await service.assertInternalSendable(tx as never, 't1', 's1', 'B');
    expect(labReportService.lockReports).toHaveBeenCalledWith(tx, 't1', [
      'r1',
      'r2',
    ]);
    expect(calls).toEqual(['lock', 'check', 'check']);
  });

  it('a touched report blocks the send (after the lock, so the answer is final)', async () => {
    const { service, tx, calls } = build(false);
    await expect(
      service.assertInternalSendable(tx as never, 't1', 's1', 'B'),
    ).rejects.toBeInstanceOf(SendBlockedException);
    expect(calls[0]).toBe('lock');
  });
});
