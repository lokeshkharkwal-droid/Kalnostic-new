import { Prisma } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import { ListTransfersDto } from './dto/list-transfers.dto';

/**
 * Internal / External referral queues — the Send-date filter. `sendDate` carries a
 * time, so a day-only end date must cover the whole day.
 */
describe('SampleTransferService.findTransfers — send date range', () => {
  const findMany = jest.fn<
    Promise<unknown[]>,
    [{ where: Prisma.SampleTransferWhereInput }]
  >();
  const count = jest.fn<
    Promise<number>,
    [{ where: Prisma.SampleTransferWhereInput }]
  >();
  const tx = { sampleTransfer: { findMany, count } };
  const prisma = {
    withTenant: (_t: string, fn: (t: typeof tx) => unknown) => fn(tx),
  };
  const service = new SampleTransferService(
    prisma as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );

  const sendDateOf = async (query: Partial<ListTransfersDto>) => {
    findMany.mockReset().mockResolvedValue([]);
    count.mockReset().mockResolvedValue(0);
    await service.findTransfers('t1', 'b1', query);
    return findMany.mock.calls[0]?.[0].where.sendDate as
      | { gte?: Date; lt?: Date; lte?: Date }
      | undefined;
  };

  it('a single day covers that whole day', async () => {
    expect(
      await sendDateOf({ dateFrom: '2026-10-06', dateTo: '2026-10-06' }),
    ).toEqual({
      gte: new Date('2026-10-06T00:00:00.000Z'),
      lt: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('a transfer sent late on the end day is inside the range', async () => {
    const r = (await sendDateOf({
      dateFrom: '2026-10-05',
      dateTo: '2026-10-06',
    }))!;
    const late = new Date('2026-10-06T19:00:00.000Z');
    expect(late >= r.gte! && late < r.lt!).toBe(true);
  });

  it('adds no send-date condition without a date', async () => {
    expect(await sendDateOf({})).toBeUndefined();
  });

  it('the count uses the same condition as the list', async () => {
    await sendDateOf({ dateFrom: '2026-10-06', dateTo: '2026-10-06' });
    expect(count.mock.calls[0]?.[0].where.sendDate).toEqual(
      findMany.mock.calls[0]?.[0].where.sendDate,
    );
  });
});
