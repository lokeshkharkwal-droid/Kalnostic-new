import { OrderStatus } from '@prisma/client';
import { TatService } from './tat.service';

/** TAT analytics leave cancelled orders out. */
describe('TatService.summary - cancelled orders', () => {
  const groupBy = jest.fn().mockResolvedValue([]);
  const aggregate = jest
    .fn()
    .mockResolvedValue({ _count: { _all: 0 }, _avg: { tatNetMinutes: null } });
  const prisma = { labReport: { groupBy, aggregate } };
  const service = new TatService(prisma as never);

  it('filters the report group-by and the average on the order status', async () => {
    await service.summary('t1', 'A', {});
    const groupWhere = (
      groupBy.mock.calls[0] as [{ where: { orderItem: unknown } }]
    )[0].where;
    const aggWhere = (
      aggregate.mock.calls[0] as [{ where: { orderItem: unknown } }]
    )[0].where;
    const expected = { order: { status: { not: OrderStatus.CANCELLED } } };
    expect(groupWhere.orderItem).toEqual(expected);
    expect(aggWhere.orderItem).toEqual(expected);
  });
});
