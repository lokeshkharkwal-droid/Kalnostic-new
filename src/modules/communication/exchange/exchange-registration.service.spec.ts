import { ExchangeRegistrationService } from './exchange-registration.service';
import { ExchangeClient } from './exchange.client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ExchangeRegistrationFailedException,
  ExchangeTenantIdMissingException,
} from './exceptions/exchange-registration.exceptions';
import { NotFoundException } from '../../../common/exceptions/kaltros.exception';

describe('ExchangeRegistrationService', () => {
  const prisma = {
    tenant: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  };
  const exchange = {
    registerClient: jest.fn(),
    isClientOk: jest.fn(),
  };
  let service: ExchangeRegistrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExchangeRegistrationService(
      prisma as unknown as PrismaService,
      exchange as unknown as ExchangeClient,
    );
  });

  const tenant = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    name: 'Acme Labs',
    email: 'a@b.com',
    phone: '9999999999',
    shortName: 'ACME',
    exchangeTenantId: 105,
    exchangeRegisteredAt: null,
    exchangeClientId: null,
    ...over,
  });

  it('throws NotFound when the tenant does not exist', async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);
    await expect(service.registerTenant('t1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(exchange.registerClient).not.toHaveBeenCalled();
  });

  it('is a no-op when the tenant is already registered', async () => {
    prisma.tenant.findFirst.mockResolvedValue(
      tenant({ exchangeRegisteredAt: new Date(), exchangeClientId: 'C9' }),
    );
    const r = await service.registerTenant('t1');
    expect(r.status).toBe('already_registered');
    expect(r.exchangeClientId).toBe('C9');
    expect(exchange.registerClient).not.toHaveBeenCalled();
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('throws when the tenant has no exchangeTenantId', async () => {
    prisma.tenant.findFirst.mockResolvedValue(
      tenant({ exchangeTenantId: null }),
    );
    await expect(service.registerTenant('t1')).rejects.toBeInstanceOf(
      ExchangeTenantIdMissingException,
    );
    expect(exchange.registerClient).not.toHaveBeenCalled();
  });

  it('registers and persists state on a successful Exchange response', async () => {
    prisma.tenant.findFirst.mockResolvedValue(tenant());
    exchange.registerClient.mockResolvedValue({
      s: '200',
      data: { original: { id: 'CLIENT-1', business_id: 105 } },
    });
    exchange.isClientOk.mockReturnValue(true);
    prisma.tenant.update.mockResolvedValue({});

    const r = await service.registerTenant('t1');

    expect(r.status).toBe('registered');
    expect(r.exchangeTenantId).toBe(105);
    expect(r.exchangeClientId).toBe('CLIENT-1');
    // peer_tenant_id / business_id are the existing exchangeTenantId (no new id).
    expect(exchange.registerClient).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '105' }),
      expect.objectContaining({ businessId: 105 }),
    );
    expect(prisma.tenant.update).toHaveBeenCalledTimes(1);
    const calls = prisma.tenant.update.mock.calls as unknown as Array<
      [
        {
          data: { exchangeClientId: string | null; exchangeRegisteredAt: Date };
        },
      ]
    >;
    const firstCall = calls[0];
    if (!firstCall) throw new Error('expected a tenant.update call');
    expect(firstCall[0].data.exchangeClientId).toBe('CLIENT-1');
    expect(firstCall[0].data.exchangeRegisteredAt).toBeInstanceOf(Date);
  });

  it('throws and does not persist when the Exchange rejects', async () => {
    prisma.tenant.findFirst.mockResolvedValue(tenant());
    exchange.registerClient.mockResolvedValue({ s: '400', m: 'nope' });
    exchange.isClientOk.mockReturnValue(false);

    await expect(service.registerTenant('t1')).rejects.toBeInstanceOf(
      ExchangeRegistrationFailedException,
    );
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });
});
