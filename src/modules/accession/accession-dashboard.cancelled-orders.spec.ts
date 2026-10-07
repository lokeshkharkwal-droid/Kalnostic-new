import { OrderStatus } from '@prisma/client';
import { AccessionDashboardService } from './accession-dashboard.service';

/** The dashboard leaves cancelled orders' samples out of its counts. */
describe('AccessionDashboardService - cancelled orders', () => {
  const groupBy = jest.fn().mockResolvedValue([]);
  const prisma = { orderSample: { groupBy } };
  const service = new AccessionDashboardService(prisma as never, {} as never);

  it('the order status overview counts only live orders', async () => {
    await service.getOrderStatusOverview('t1', 'A');
    const where = (
      groupBy.mock.calls[0] as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where.order).toEqual({ status: { not: OrderStatus.CANCELLED } });
    expect(where.deletedAt).toBeNull();
    expect(where.tenantId).toBe('t1');
  });
});
