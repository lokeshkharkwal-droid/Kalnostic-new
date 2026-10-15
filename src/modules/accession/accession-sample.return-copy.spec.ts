import { OrderSampleService } from './accession-sample.service';
import {
  SampleReturnBlockedException,
  SampleSentToBranchException,
} from './exceptions/accession.exceptions';

/**
 * The receiving branch's Repeat/Return of an accepted copy: allowed while the
 * report is still work in progress (it is reset on the way back), refused only
 * once the result is validated.
 */
function build(canReturn: boolean, copyStatus = 'ACCEPTED') {
  const calls: string[] = [];
  const labReportService = {
    findReportIdsForSampleTests: jest.fn().mockResolvedValue(['r1', 'r2']),
    lockReports: jest.fn(() => {
      calls.push('lock');
      return Promise.resolve();
    }),
    canReturnToSender: jest.fn(() => {
      calls.push('check');
      return Promise.resolve(canReturn);
    }),
    resetReportsForReturn: jest.fn(() => {
      calls.push('reset');
      return Promise.resolve();
    }),
    moveReportsToBranch: jest.fn(() => {
      calls.push('move');
      return Promise.resolve();
    }),
  };
  const tx = {
    orderSample: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'copy1',
          branchId: 'B',
          status: copyStatus,
          sourceTransferId: 'tr1',
          tests: [{ orderItemId: 'i1', labTestId: 'lt1' }],
        })
        .mockResolvedValueOnce({ id: 'orig1', branchId: 'A' }),
      update: jest.fn().mockResolvedValue({}),
    },
    sampleTransfer: {
      findFirst: jest.fn().mockResolvedValue({ id: 'tr1', sampleId: 'orig1' }),
    },
    orderSampleTest: { updateMany: jest.fn().mockResolvedValue({}) },
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
  const transition = jest.fn(() => {
    calls.push('transition');
    return Promise.resolve();
  });
  (service as unknown as { transitionInTx: unknown }).transitionInTx =
    transition;
  return { service, tx, labReportService, calls, transition };
}

describe('OrderSampleService.returnCopyToOrigin - Repeat below Result Done', () => {
  it('locks, checks, resets, then moves the reports and repeats the original', async () => {
    const { service, tx, labReportService, calls, transition } = build(true);
    const originId = await service.returnCopyToOrigin(
      tx as never,
      't1',
      'u1',
      'copy1',
      'wrong sample',
    );
    expect(originId).toBe('orig1');
    expect(calls).toEqual(['lock', 'check', 'reset', 'move', 'transition']);
    expect(labReportService.resetReportsForReturn).toHaveBeenCalledWith(
      tx,
      't1',
      ['r1', 'r2'],
      'u1',
    );
    expect(labReportService.moveReportsToBranch).toHaveBeenCalledWith(
      tx,
      't1',
      ['r1', 'r2'],
      'A',
    );
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it('a validated result blocks it, before anything is changed', async () => {
    const { service, tx, labReportService, calls } = build(false);
    await expect(
      service.returnCopyToOrigin(tx as never, 't1', 'u1', 'copy1', 'x'),
    ).rejects.toBeInstanceOf(SampleReturnBlockedException);
    expect(calls).toEqual(['lock', 'check']);
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(tx.orderSampleTest.updateMany).not.toHaveBeenCalled();
    expect(labReportService.resetReportsForReturn).not.toHaveBeenCalled();
  });

  it.each(['SENT_INTERNAL', 'FORWARD_EXTERNAL', 'OUTSOURCED'])(
    'a copy this branch has already passed on (%s) cannot be sent back, and nothing is read or changed',
    async (status) => {
      const { service, tx, labReportService, calls, transition } = build(
        true,
        status,
      );
      await expect(
        service.returnCopyToOrigin(tx as never, 't1', 'u1', 'copy1', 'x'),
      ).rejects.toBeInstanceOf(SampleSentToBranchException);
      // refused before the transfer, the reports or anything else is touched
      expect(calls).toEqual([]);
      expect(tx.sampleTransfer.findFirst).not.toHaveBeenCalled();
      expect(labReportService.lockReports).not.toHaveBeenCalled();
      expect(tx.orderSample.update).not.toHaveBeenCalled();
      expect(tx.orderSampleTest.updateMany).not.toHaveBeenCalled();
      expect(labReportService.resetReportsForReturn).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
    },
  );

  it.each([
    [undefined, 'repeat'],
    ['repeat', 'repeat'],
    ['reject', 'reject'],
  ] as const)(
    'the "already passed on" refusal names the action pressed (%s -> "%s")',
    async (given, named) => {
      const { service, tx } = build(true, 'SENT_INTERNAL');
      const err = (await service
        .returnCopyToOrigin(tx as never, 't1', 'u1', 'copy1', 'x', given)
        .catch((e: unknown) => e)) as SampleSentToBranchException;
      expect(err).toBeInstanceOf(SampleSentToBranchException);
      const message = (err.getResponse() as { error: { message: string } })
        .error.message;
      expect(message).toContain(`"${named}" is not allowed`);
      expect(message).not.toContain(
        `"${named === 'repeat' ? 'reject' : 'repeat'}"`,
      );
      expect(err.errorCode).toBe('SAMPLE_SENT_TO_BRANCH');
    },
  );

  it('the action word changes only the wording: a reject of a copy that can go back behaves exactly like a repeat', async () => {
    const { service, tx, calls } = build(true);
    await service.returnCopyToOrigin(
      tx as never,
      't1',
      'u1',
      'copy1',
      'x',
      'reject',
    );
    expect(calls).toEqual(['lock', 'check', 'reset', 'move', 'transition']);
  });

  it('a copy that was passed on and then retrieved back (ACCEPTED again) can be returned as usual', async () => {
    const { service, tx, calls } = build(true, 'ACCEPTED');
    await service.returnCopyToOrigin(tx as never, 't1', 'u1', 'copy1', 'x');
    expect(calls).toEqual(['lock', 'check', 'reset', 'move', 'transition']);
  });

  it('no longer asks whether the report is untouched', async () => {
    const { service, tx, labReportService } = build(true);
    (labReportService as Record<string, unknown>).isReportUntouched = jest.fn();
    await service.returnCopyToOrigin(tx as never, 't1', 'u1', 'copy1', 'x');
    expect(
      (labReportService as Record<string, jest.Mock>).isReportUntouched,
    ).not.toHaveBeenCalled();
  });
});
