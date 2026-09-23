import {
  EXCHANGE_TENANT_ID_COUNTER_KEY,
  ExchangeTenantIdService,
} from './exchange-tenant-id.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ExchangeTenantIdService', () => {
  const tx = {
    platformCounter: {
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    tenant: { aggregate: jest.fn() },
  };
  let service: ExchangeTenantIdService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExchangeTenantIdService({} as unknown as PrismaService);
  });

  const asTx = () => tx as unknown as Parameters<typeof service.allocate>[0];

  it('allocate increments the counter and returns the new value', async () => {
    tx.platformCounter.update.mockResolvedValue({ value: 106 });
    const id = await service.allocate(asTx());
    expect(id).toBe(106);
    expect(tx.platformCounter.update).toHaveBeenCalledWith({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY },
      data: { value: { increment: 1 } },
      select: { value: true },
    });
  });

  it('bumpTo only raises the counter (never lowers)', async () => {
    tx.platformCounter.updateMany.mockResolvedValue({ count: 1 });
    await service.bumpTo(asTx(), 200);
    expect(tx.platformCounter.updateMany).toHaveBeenCalledWith({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY, value: { lt: 200 } },
      data: { value: 200 },
    });
  });

  it('resolveForCreate keeps a migrated legacy id and bumps the counter', async () => {
    tx.platformCounter.updateMany.mockResolvedValue({ count: 1 });
    const id = await service.resolveForCreate(asTx(), 105);
    expect(id).toBe(105);
    expect(tx.platformCounter.updateMany).toHaveBeenCalled();
    expect(tx.platformCounter.update).not.toHaveBeenCalled();
  });

  it('resolveForCreate allocates for a native tenant (no legacy id)', async () => {
    tx.platformCounter.update.mockResolvedValue({ value: 107 });
    const id = await service.resolveForCreate(asTx(), null);
    expect(id).toBe(107);
    expect(tx.platformCounter.update).toHaveBeenCalled();
  });

  it('seedFloor raises the counter to the max of counter/legacy/exchange', async () => {
    tx.tenant.aggregate.mockResolvedValue({
      _max: { legacyTenantId: 105, exchangeTenantId: 105 },
    });
    tx.platformCounter.findUnique.mockResolvedValue({ value: 0 });
    tx.platformCounter.updateMany.mockResolvedValue({ count: 1 });
    const floor = await service.seedFloor(asTx());
    expect(floor).toBe(105);
    expect(tx.platformCounter.updateMany).toHaveBeenCalledWith({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY, value: { lt: 105 } },
      data: { value: 105 },
    });
  });
});
