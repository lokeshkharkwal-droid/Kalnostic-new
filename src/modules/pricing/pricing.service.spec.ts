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

describe('PricingService.calculate — Update Order keeps sold prices', () => {
  // Master data AFTER the price change: A is now 700, new test C is 250.
  const build = (status: string, appointmentStatus: string | null = null) => {
    const prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          status,
          appointment: appointmentStatus ? { status: appointmentStatus } : null,
        }),
      },
      orderItem: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { unitPrice: 500, branchLabTestId: 'A', branchLabPanelId: null },
          ]),
      },
      branchLabTest: {
        findMany: jest.fn((args: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            [
              { id: 'A', listPrice: 700, emergencyPrice: 0 },
              { id: 'C', listPrice: 250, emergencyPrice: 0 },
            ].filter((t) => args.where.id.in.includes(t.id)),
          ),
        ),
      },
      branchLabPanel: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return {
      prisma,
      service: new PricingService(prisma as unknown as PrismaService),
    };
  };
  const body = {
    orderId: 'o1',
    keptItemIds: ['iA'],
    labTestIds: ['A', 'C'],
  };

  it('prices the kept line at its stored price and only the new test live', async () => {
    const { service, prisma } = build('ORDER');
    const r = await service.calculate('t1', 'b1', body);
    expect(r.totalAmount).toBe(500 + 250); // not 700 + 250
    const liveLookup = (
      prisma.branchLabTest.findMany.mock.calls as Array<
        [{ where: { id: { in: string[] } } }]
      >
    )[0][0];
    expect(liveLookup.where.id.in).toEqual(['C']);
  });

  it('does not count a kept item whose test was removed from the form', async () => {
    const { service } = build('ORDER');
    const r = await service.calculate('t1', 'b1', {
      ...body,
      labTestIds: ['C'],
    });
    expect(r.totalAmount).toBe(250);
  });

  it('prices everything live for a DRAFT (not yet billed)', async () => {
    const { service } = build('DRAFT');
    const r = await service.calculate('t1', 'b1', body);
    expect(r.totalAmount).toBe(700 + 250);
  });

  it('prices everything live without an orderId (Create Order)', async () => {
    const { service } = build('ORDER');
    const r = await service.calculate('t1', 'b1', {
      labTestIds: ['A', 'C'],
    });
    expect(r.totalAmount).toBe(700 + 250);
  });

  it('freezes a checked-in appointment', async () => {
    const { service } = build('APPOINTMENT', 'CHECKED_IN');
    const r = await service.calculate('t1', 'b1', body);
    expect(r.totalAmount).toBe(500 + 250);
  });
});
