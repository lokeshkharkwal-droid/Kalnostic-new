import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from './pricing.service';

describe('PricingService.calculate — emergency pricing preview', () => {
  const prisma = {
    branchLabTest: {
      findMany: jest.fn().mockResolvedValue([
        { listPrice: 500, emergencyPrice: 900 },
        { listPrice: 700, emergencyPrice: 0 }, // no emergency price set
      ]),
    },
    branchLabPanel: {
      findMany: jest.fn().mockResolvedValue([{ listPrice: 1200 }]),
    },
  };
  const service = new PricingService(prisma as unknown as PrismaService);
  const body = {
    labTestIds: ['a', 'b'],
    labPanelIds: ['p'],
    orderDiscount: 100,
    sampleCollectionCharges: 50,
  };

  it('sums list prices by default (Quotations never send the flag)', async () => {
    const r = await service.calculate('t1', 'b1', body);
    expect(r.totalAmount).toBe(500 + 700 + 1200);
    expect(r.payableAmount).toBe(2400 - 100 + 50);
  });

  it('uses Emergency Price for tests when set, list price otherwise; panels unchanged', async () => {
    const r = await service.calculate('t1', 'b1', {
      ...body,
      emergencyPricing: true,
    });
    expect(r.totalAmount).toBe(900 + 700 + 1200);
    expect(r.payableAmount).toBe(2800 - 100 + 50);
  });
});
