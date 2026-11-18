import { InventoryConsumptionService } from './inventory-consumption.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type {
  InventoryConsumptionClient,
  InventoryValidateResult,
} from './inventory-consumption.client';

/** A fake inventory client with toggleable enablement + spyable calls. */
function makeClient(enabled: boolean) {
  const validate = jest.fn(
    (): Promise<InventoryValidateResult> =>
      Promise.resolve({
        hasMapping: true,
        ok: true,
        proformas: [],
        products: [],
        shortages: [],
      }),
  );
  const consume = jest.fn(() =>
    Promise.resolve({
      consumed: true,
      alreadyConsumed: false,
      hasMapping: true,
      saleId: 'sale1',
    }),
  );
  const info = jest.fn(() =>
    Promise.resolve({ mapped: true, proformas: [] }),
  );
  return {
    client: {
      get isEnabled() {
        return enabled;
      },
      validate,
      consume,
      info,
    } as unknown as InventoryConsumptionClient,
    validate,
    consume,
    info,
  };
}

/** Fake prisma whose branchLabTest.findMany maps branch ids → source ids. */
function makePrisma(map: Record<string, string | null>) {
  return {
    branchLabTest: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in
            .filter((id) => id in map)
            .map((id) => ({ sourceLabTestId: map[id] })),
        ),
      ),
    },
    patient: {
      findFirst: jest.fn(() =>
        Promise.resolve({ firstName: 'Jane', middleName: null, lastName: 'Doe' }),
      ),
    },
  } as unknown as PrismaService;
}

describe('InventoryConsumptionService', () => {
  it('is a no-op when the integration is disabled', async () => {
    const { client, validate } = makeClient(false);
    const prisma = makePrisma({ blt1: 'lt1' });
    const svc = new InventoryConsumptionService(prisma, client);

    expect(svc.isEnabled).toBe(false);
    const res = await svc.validateForOrder('t1', 'b1', [{ branchLabTestId: 'blt1' }]);
    expect(res).toBeNull();
    expect(validate).not.toHaveBeenCalled();
  });

  it('resolves branch lab tests to source ids and validates', async () => {
    const { client, validate } = makeClient(true);
    const prisma = makePrisma({ blt1: 'lt1', blt2: 'lt2' });
    const svc = new InventoryConsumptionService(prisma, client);

    await svc.validateForOrder('t1', 'b1', [
      { branchLabTestId: 'blt1' },
      { branchLabTestId: 'blt2' },
    ]);
    expect(validate).toHaveBeenCalledWith({
      branchId: 'b1',
      labTestSourceIds: ['lt1', 'lt2'],
    });
  });

  it('returns null (skips the call) when no item has a resolvable source id', async () => {
    const { client, validate } = makeClient(true);
    const prisma = makePrisma({ blt1: null }); // branch-only test, no master source
    const svc = new InventoryConsumptionService(prisma, client);

    const res = await svc.validateForOrder('t1', 'b1', [{ branchLabTestId: 'blt1' }]);
    expect(res).toBeNull();
    expect(validate).not.toHaveBeenCalled();
  });

  it('consumes for an order, forwarding order id/code + patient name', async () => {
    const { client, consume } = makeClient(true);
    const prisma = makePrisma({ blt1: 'lt1' });
    const svc = new InventoryConsumptionService(prisma, client);

    await svc.consumeForOrder('t1', 'b1', {
      id: 'order1',
      orderCode: 'ORD-00001',
      patientId: 'pat1',
      orderDate: new Date('2026-01-02T00:00:00.000Z'),
      items: [{ branchLabTestId: 'blt1' }],
    });
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({
        kalnosticsOrderId: 'order1',
        orderCode: 'ORD-00001',
        branchId: 'b1',
        labTestSourceIds: ['lt1'],
        patientId: 'pat1',
        patientName: 'Jane Doe',
      }),
    );
  });

  it('proformaInfo returns mapped=false when disabled or no branch', async () => {
    const { client } = makeClient(false);
    const prisma = makePrisma({ blt1: 'lt1' });
    const svc = new InventoryConsumptionService(prisma, client);
    const res = await svc.proformaInfo('t1', 'b1', 'blt1');
    expect(res).toEqual({ mapped: false, proformas: [] });
  });
});
