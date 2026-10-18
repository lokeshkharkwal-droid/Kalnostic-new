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
