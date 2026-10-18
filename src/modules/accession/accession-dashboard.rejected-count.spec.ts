import { TransferStatus } from '@prisma/client';
import { AccessionDashboardService } from './accession-dashboard.service';
import {
  ORDER_ITEM_REMOVED_REASON,
  RECALLED_VIA_RETRIEVE_REASON,
} from './constants/transfer-close-reasons.constant';

/**
 * "Rejected Samples" is the receiving branch's own rejections. A transfer the SYSTEM
 * closed as REJECTED (the sender's Retrieve, a test removed from the order) is not a
 * rejection decision and must not be counted; a rejection with no reason still is.
 */
describe('AccessionDashboardService - Rejected Samples count', () => {
  function build(rejected = 2) {
    const count = jest.fn().mockResolvedValue(rejected);
    const prisma = {
      orderSample: { findMany: jest.fn().mockResolvedValue([]) },
      sampleTransfer: { count },
    };
    const service = new AccessionDashboardService(prisma as never, {} as never);
    jest
      .spyOn(
        service as unknown as { tatThresholds: (...a: unknown[]) => unknown },
        'tatThresholds',
      )
      .mockImplementation(() =>
        Promise.resolve({
          maxMinutes: 20,
          warningMinutes: 10,
          criticalMinutes: 15,
        }),
      );
    return { service, count };
  }

  it('counts only REJECTED transfers of the receiving branch that the system did not close', async () => {
    const m = build(2);
    const alerts = await m.service.getCriticalAlerts('t1', 'B');
    expect(alerts.find((a) => a.label === 'Rejected Samples')?.value).toBe(2);
    const where = (
      m.count.mock.calls[0] as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where).toMatchObject({
      tenantId: 't1',
      destinationBranchId: 'B',
      transferStatus: TransferStatus.REJECTED,
    });
    // the two system close reasons are excluded; a row with no reason still counts
    expect(where.OR).toEqual([
      { rejectionReason: null },
      {
        rejectionReason: {
          notIn: [RECALLED_VIA_RETRIEVE_REASON, ORDER_ITEM_REMOVED_REASON],
        },
      },
    ]);
  });
});
