import { MessagingChannel, RecipientType } from '@prisma/client';
import { CommunicationService } from './communication.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeClient } from './exchange/exchange.client';
import { TemplateService } from '../template/template.service';
import { BranchService } from '../branch/branch.service';
import { NotificationTagsService } from './services/notification-tags.service';
import { SendMessageDto } from './dto/send-message.dto';
import { TenantNotRegisteredWithExchangeException } from './exceptions/communication.exceptions';

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
      {} as unknown as NotificationTagsService,
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

describe('CommunicationService — Exchange-registration gate', () => {
  const tenantFindUnique = jest.fn();
  const communicationCreate = jest.fn();
  let service: CommunicationService;

  const dto: SendMessageDto = {
    channel: MessagingChannel.SMS,
    body: 'hi',
    recipients: [
      {
        recipientType: RecipientType.PATIENT,
        recipientId: 'p-1',
        recipientName: 'Asha',
        toAddress: '9999999999',
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const prisma = {
      tenant: { findUnique: tenantFindUnique },
      withTenant: jest.fn((_t: string, cb: (c: unknown) => unknown) =>
        cb({ communicationLog: { create: communicationCreate } }),
      ),
    } as unknown as PrismaService;
    service = new CommunicationService(
      prisma,
      {} as unknown as ExchangeClient,
      {} as unknown as TemplateService,
      {} as unknown as BranchService,
      {} as unknown as NotificationTagsService,
    );
  });

  it('enqueue throws when the tenant is not registered with the Exchange', async () => {
    tenantFindUnique.mockResolvedValue({ exchangeRegisteredAt: null });
    await expect(service.enqueue('t-1', null, dto)).rejects.toBeInstanceOf(
      TenantNotRegisteredWithExchangeException,
    );
    expect(communicationCreate).not.toHaveBeenCalled();
  });

  it('getExchangeStatus reflects exchangeRegisteredAt', async () => {
    tenantFindUnique.mockResolvedValueOnce({
      exchangeRegisteredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await expect(service.getExchangeStatus('t-1')).resolves.toEqual({
      isRegistered: true,
    });

    tenantFindUnique.mockResolvedValueOnce({ exchangeRegisteredAt: null });
    await expect(service.getExchangeStatus('t-1')).resolves.toEqual({
      isRegistered: false,
    });
  });
});

describe('CommunicationService.findForOrder — Past Notifications', () => {
  const findMany = jest.fn();
  const count = jest.fn();
  let service: CommunicationService;

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'log-1',
    channel: MessagingChannel.WHATSAPP,
    status: 'SENT',
    feature: 'order_bill_as_attachment',
    recipientType: RecipientType.PATIENT,
    recipientName: 'Asha',
    toAddress: '9999999999',
    subject: null,
    body: 'Your bill',
    statusMessage: 'Delivered via Exchange gateway',
    sentAt: new Date('2026-11-25T18:24:00.000Z'),
    createdAt: new Date('2026-11-25T18:23:00.000Z'),
    createdBy: 'u-1',
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CommunicationService(
      { communicationLog: { findMany, count } } as unknown as PrismaService,
      {} as unknown as ExchangeClient,
      {} as unknown as TemplateService,
      {} as unknown as BranchService,
      {} as unknown as NotificationTagsService,
    );
  });

  it('lists only this tenant + order, deliverable channels, newest first, without the payload', async () => {
    findMany.mockResolvedValue([row()]);
    count.mockResolvedValue(1);

    await service.findForOrder('t-1', 'o-1', {});

    const where = {
      tenantId: 't-1',
      orderId: 'o-1',
      deletedAt: null,
      channel: {
        in: [
          MessagingChannel.EMAIL,
          MessagingChannel.SMS,
          MessagingChannel.WHATSAPP,
        ],
      },
    };
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 0,
        take: 20,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(count).toHaveBeenCalledWith({ where });
    const [[findArgs]] = findMany.mock.calls as [[{ select: object }]];
    const select = findArgs.select;
    expect(select).not.toHaveProperty('payload');
  });

  it('maps the feature label and flags automatic (system) sends', async () => {
    findMany.mockResolvedValue([
      row(),
      row({ id: 'log-2', feature: null, createdBy: 'system' }),
      row({ id: 'log-3', feature: 'not_in_catalogue' }),
    ]);
    count.mockResolvedValue(3);

    const res = await service.findForOrder('t-1', 'o-1', {});

    expect(res.data[0]).toMatchObject({
      id: 'log-1',
      featureLabel: 'Order Bill as Attachment',
      isAutomatic: false,
    });
    expect(res.data[0]).not.toHaveProperty('createdBy');
    expect(res.data[1]).toMatchObject({
      featureLabel: null,
      isAutomatic: true,
    });
    expect(res.data[2]).toMatchObject({ featureLabel: 'not_in_catalogue' });
  });

  it('paginates with the requested page + limit', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(130);

    const res = await service.findForOrder('t-1', 'o-1', {
      page: 2,
      limit: 100,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 100 }),
    );
    expect(res).toEqual({ data: [], total: 130, page: 2, limit: 100 });
  });
});
