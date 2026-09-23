import { MessagingChannel } from '@prisma/client';
import { CommunicationService } from './communication.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeClient } from './exchange/exchange.client';
import { TemplateService } from '../template/template.service';
import { BranchService } from '../branch/branch.service';

describe('CommunicationService.dispatch — peer tenant id', () => {
  const tenantFindUnique = jest.fn();
  const sendSms = jest.fn().mockResolvedValue({ id: 'ok' });
  let service: CommunicationService;

  const buildRow = () =>
    ({
      id: 'log-1',
      tenantId: 'uuid-tenant-1',
      branchId: null,
      channel: MessagingChannel.SMS,
      toAddress: '9999999999',
      subject: null,
      body: 'hi',
      feature: 'ad_hoc',
      payload: null,
    }) as unknown as Parameters<CommunicationService['dispatch']>[0];

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CommunicationService(
      { tenant: { findUnique: tenantFindUnique } } as unknown as PrismaService,
      { sendSms } as unknown as ExchangeClient,
      {} as unknown as TemplateService,
      {} as unknown as BranchService,
    );
  });

  it('sends the integer exchangeTenantId as peer.tenantId', async () => {
    tenantFindUnique.mockResolvedValue({ exchangeTenantId: 106 });
    await service.dispatch(buildRow());
    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '106' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('blocks the send (returns null) when exchangeTenantId is missing', async () => {
    tenantFindUnique.mockResolvedValue({ exchangeTenantId: null });
    const result = await service.dispatch(buildRow());
    expect(result).toBeNull();
    expect(sendSms).not.toHaveBeenCalled();
  });
});
