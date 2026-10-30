import { OrderSampleService } from './accession-sample.service';
import {
  SampleReturnBlockedException,
  SampleReturnOrderCancelledException,
  SampleSentToBranchException,
} from './exceptions/accession.exceptions';

/**
 * The receiving branch's Repeat/Return of an accepted copy: allowed while the
 * report is still work in progress (it is reset on the way back), refused only
 * once the result is validated.
 */
function build(canReturn: boolean, copyStatus = 'ACCEPTED', cancelled = false) {
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
          orderId: 'o1',
          sourceTransferId: 'tr1',
          tests: [{ orderItemId: 'i1', labTestId: 'lt1' }],
        })
        .mockResolvedValueOnce({ id: 'orig1', branchId: 'A' }),
      update: jest.fn().mockResolvedValue({}),
    },
    sampleTransfer: {
      findFirst: jest.fn().mockResolvedValue({ id: 'tr1', sampleId: 'orig1' }),
    },
    // the "order cancelled" probe
    order: {
      findFirst: jest.fn().mockResolvedValue(cancelled ? { id: 'o1' } : null),
    },
    orderSampleTest: {
      updateMany: jest.fn().mockResolvedValue({}),
      // the "test removed from the order" probe: no removed test
      findMany: jest.fn().mockResolvedValue([]),
    },
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
    {} as never,
  );
  const transition = jest.fn(() => {
    calls.push('transition');
    return Promise.resolve();
  });
  (service as unknown as { transitionInTx: unknown }).transitionInTx =
    transition;
  // Back on the SENDER's own copy of the test: after the clear-down and the move, never before.
  const pointAtSender = jest.fn(() => {
    calls.push('point');
    return Promise.resolve();
  });
  (
    service as unknown as { pointReportsAtBranchSetup: unknown }
  ).pointReportsAtBranchSetup = pointAtSender;
  // The sender's original is NOT moved any more (it stays Sent); only its trail
  // entry is written.
  const record = jest.fn(() => {
    calls.push('record');
    return Promise.resolve();
  });
  (
    service as unknown as { recordReturnedByReceiverInTx: unknown }
  ).recordReturnedByReceiverInTx = record;
  return {
    service,
    tx,
    labReportService,
    calls,
    transition,
    record,
    pointAtSender,
  };
}

describe('OrderSampleService.returnCopyToOrigin - Repeat below Result Done', () => {
  it('locks, checks, resets, then moves the reports and records the return on the original, which stays Sent', async () => {
    const {
      service,
      tx,
      labReportService,
      calls,
      transition,
      record,
      pointAtSender,
    } = build(true);
    const originId = await service.returnCopyToOrigin(
      tx as never,
      't1',
      'u1',
      'copy1',
      'wrong sample',
    );
    expect(originId).toBe('orig1');
    expect(calls).toEqual([
      'lock',
      'check',
      'reset',
      'move',
      'point',
      'record',
    ]);
    // the report is pointed at the SENDER's copy of the test (the branch it moved to)
    expect(pointAtSender).toHaveBeenCalledWith(tx, 't1', 'A', ['r1', 'r2']);
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
    // the sender's original is not moved to Repeat: it reads "Sent – Repeated"
    // until the sender decides
    expect(transition).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      tx,
      't1',
      'u1',
      'orig1',
      'wrong sample',
    );
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

  it('on a CANCELLED order an accepted copy cannot be sent back (its results are kept): refused before anything is read or changed', async () => {
    const { service, tx, labReportService, calls, transition } = build(
      true,
      'ACCEPTED',
      true,
    );
    const err = await service
      .returnCopyToOrigin(tx as never, 't1', 'u1', 'copy1', 'x')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SampleReturnOrderCancelledException);
    expect((err as { errorCode: string }).errorCode).toBe(
      'SAMPLE_ORDER_CANCELLED',
    );
    expect(calls).toEqual([]);
    expect(tx.sampleTransfer.findFirst).not.toHaveBeenCalled();
    expect(labReportService.lockReports).not.toHaveBeenCalled();
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(tx.orderSampleTest.updateMany).not.toHaveBeenCalled();
    expect(labReportService.resetReportsForReturn).not.toHaveBeenCalled();
    expect(labReportService.moveReportsToBranch).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('a normal (not cancelled) order still lets the copy go back', async () => {
    const { service, tx } = build(true, 'ACCEPTED', false);
    await expect(
      service.returnCopyToOrigin(tx as never, 't1', 'u1', 'copy1', 'x'),
    ).resolves.toBe('orig1');
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
    expect(calls).toEqual([
      'lock',
      'check',
      'reset',
      'move',
      'point',
      'record',
    ]);
  });

  it('a copy that was passed on and then retrieved back (ACCEPTED again) can be returned as usual', async () => {
    const { service, tx, calls } = build(true, 'ACCEPTED');
    await service.returnCopyToOrigin(tx as never, 't1', 'u1', 'copy1', 'x');
    expect(calls).toEqual([
      'lock',
      'check',
      'reset',
      'move',
      'point',
      'record',
    ]);
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
