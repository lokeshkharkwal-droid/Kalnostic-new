import { SampleStatus } from '@prisma/client';
import { OrderSampleService } from './accession-sample.service';
import {
  InvalidSampleTransitionException,
  SampleRepeatBlockedException,
} from './exceptions/accession.exceptions';

/**
 * A user's Repeat of a sample at its own branch starts the report over, and is
 * refused once the result is validated (Result Done, Approved, Published).
 */
function build(opts: { canReturn?: boolean; reportIds?: string[] } = {}) {
  const calls: string[] = [];
  const labReportService = {
    findReportIdsForSampleTests: jest.fn(() =>
      Promise.resolve(opts.reportIds ?? ['r1']),
    ),
    lockReports: jest.fn(() => {
      calls.push('lock');
      return Promise.resolve();
    }),
    canReturnToSender: jest.fn(() => {
      calls.push('check');
      return Promise.resolve(opts.canReturn ?? true);
    }),
    resetReportsForReturn: jest.fn(() => {
      calls.push('reset');
      return Promise.resolve();
    }),
  };
  const tx = {
    order: { findFirst: jest.fn().mockResolvedValue(null) },
    orderSample: {
      findFirst: jest.fn().mockResolvedValue({
        id: 's1',
        orderId: 'o1',
        branchId: 'A',
        status: SampleStatus.ACCEPTED,
        sourceTransferId: null,
      }),
      updateMany: jest.fn(() => {
        calls.push('claim');
        return Promise.resolve({ count: 1 });
      }),
      update: jest.fn(() => {
        calls.push('update');
        return Promise.resolve({ id: 's1', status: SampleStatus.REPEAT });
      }),
    },
    orderSampleTest: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ orderItemId: 'i1', labTestId: 'lt1' }]),
    },
    orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
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
  const repeat = (note = {}) =>
    service.transitionInTx(
      tx as never,
      't1',
      'u1',
      's1',
      'repeat',
      () => ({ data: {}, reason: 'bad tube' }),
      note,
    );
  return { service, tx, labReportService, calls, repeat };
}

describe('OrderSampleService.transitionInTx - Repeat starts the report over', () => {
  it('locks and checks the reports first, changes the sample, then resets them', async () => {
    const { repeat, labReportService, calls } = build();
    await repeat();
    expect(calls).toEqual(['lock', 'check', 'claim', 'update', 'reset']);
    expect(labReportService.findReportIdsForSampleTests).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      'A',
      [{ orderItemId: 'i1', labTestId: 'lt1' }],
    );
    expect(labReportService.resetReportsForReturn).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      ['r1'],
      'u1',
    );
  });

  it('a validated result refuses the Repeat before anything changes', async () => {
    const { repeat, tx, labReportService, calls } = build({ canReturn: false });
    await expect(repeat()).rejects.toBeInstanceOf(SampleRepeatBlockedException);
    expect(calls).toEqual(['lock', 'check']);
    expect(tx.orderSample.updateMany).not.toHaveBeenCalled();
    expect(tx.orderSample.update).not.toHaveBeenCalled();
    expect(labReportService.resetReportsForReturn).not.toHaveBeenCalled();
  });

  it('the refusal is skippable by group "skip invalid" actions', async () => {
    const { repeat } = build({ canReturn: false });
    await expect(repeat()).rejects.toBeInstanceOf(
      InvalidSampleTransitionException,
    );
  });

  it('a sample with no report yet (collected, never accepted) just repeats', async () => {
    const { repeat, labReportService, tx } = build({ reportIds: [] });
    await repeat();
    expect(tx.orderSample.update).toHaveBeenCalledTimes(1);
    expect(labReportService.resetReportsForReturn).not.toHaveBeenCalled();
  });

  it('the system-driven Repeat (a receiving branch returned it) does not reset again', async () => {
    const { repeat, labReportService, tx } = build();
    await repeat({ system: true, force: true });
    expect(tx.orderSampleTest.findMany).not.toHaveBeenCalled();
    expect(labReportService.lockReports).not.toHaveBeenCalled();
    expect(labReportService.resetReportsForReturn).not.toHaveBeenCalled();
  });

  it('other actions never look at the reports', async () => {
    const { service, tx, labReportService } = build();
    await service.transitionInTx(
      tx as never,
      't1',
      'u1',
      's1',
      'store',
      () => ({ data: {} }),
    );
    expect(tx.orderSampleTest.findMany).not.toHaveBeenCalled();
    expect(labReportService.resetReportsForReturn).not.toHaveBeenCalled();
  });
});
