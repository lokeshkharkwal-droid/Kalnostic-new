import { MessagingChannel } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ExchangeClient,
  ExchangeNotificationItemsResponse,
} from '../communication/exchange/exchange.client';
import { ExchangeRegistrationService } from '../communication/exchange/exchange-registration.service';
import { ExchangeTenantIdMissingException } from '../communication/exchange/exceptions/exchange-registration.exceptions';
import {
  MessagingReportService,
  legacyDateRange,
  normaliseGatewayTimestamp,
} from './messaging-report.service';
import {
  MessageNotFoundException,
  MessagingGatewayNotConfiguredException,
  MessagingGatewayUnavailableException,
  MessagingReportInvalidDateRangeException,
  MessagingTenantNotRegisteredException,
} from './exceptions/messaging-report.exceptions';

/**
 * The reports read the Exchange gateway (same source as the legacy
 * `subscription/business/whatsAppReport` / `smsReport` screens). The fixture
 * rows follow the legacy contract: `context_id` = recipient, `n_status` code,
 * provider `status`, naive IST timestamps, and a JSON `response` column.
 */
describe('MessagingReportService', () => {
  const TENANT = 'tenant-uuid';
  const EXCHANGE_TENANT_ID = 4321;
  const peer = { tenantId: String(EXCHANGE_TENANT_ID), tenantInfo: 'Lab' };

  // Real isReportOk / isConfigured logic on a mocked transport.
  const realClient = new ExchangeClient({
    get: () => undefined,
  } as unknown as ConfigService);

  let exchange: {
    isConfigured: jest.Mock;
    isReportOk: (r: Parameters<ExchangeClient['isReportOk']>[0]) => boolean;
    listNotificationItems: jest.Mock;
    getNotificationItemDetail: jest.Mock;
  };
  let resolvePeer: jest.Mock;
  let findMany: jest.Mock;
  let service: MessagingReportService;

  const legacyWhatsappRow = {
    id: 51234,
    context_id: '919800000001',
    n_status: 200,
    status: 'Pending',
    created_at: '2026-11-21 20:55:00',
    updated_at: '2026-11-21 20:56:30',
    response: JSON.stringify({
      template_id: 'Lab create order, Inform Patient',
      msg: 'Dear Patient, your order is booked.',
    }),
  };

  const itemsResponse = (
    rows: unknown[],
    extra: Partial<ExchangeNotificationItemsResponse> = {},
  ): ExchangeNotificationItemsResponse =>
    ({
      s: '200',
      data: { data: rows, total: 1563, per_page: 50, current_page: 1 },
      ...extra,
    }) as ExchangeNotificationItemsResponse;

  beforeEach(() => {
    exchange = {
      isConfigured: jest.fn().mockReturnValue(true),
      isReportOk: (r) => realClient.isReportOk(r),
      listNotificationItems: jest.fn(),
      getNotificationItemDetail: jest.fn(),
    };
    resolvePeer = jest
      .fn()
      .mockResolvedValue({ exchangeTenantId: EXCHANGE_TENANT_ID, peer });
    findMany = jest.fn().mockResolvedValue([]);
    service = new MessagingReportService(
      { communicationLog: { findMany } } as unknown as PrismaService,
      exchange as unknown as ExchangeClient,
      { resolvePeer } as unknown as ExchangeRegistrationService,
    );
  });

  describe('list', () => {
    it('asks the gateway for whole local days of the caller’s own tenant', async () => {
      exchange.listNotificationItems.mockResolvedValue(itemsResponse([]));
      await service.list(TENANT, 'whatsapp', {
        dateFrom: '2026-01-01',
        dateTo: '2026-11-23',
        page: 3,
        status: 'failed',
      });
      expect(resolvePeer).toHaveBeenCalledWith(TENANT);
      expect(exchange.listNotificationItems).toHaveBeenCalledWith(peer, {
        contextType: 'whatsapp',
        page: 3,
        periodFrom: '2026-01-01 00:00:00',
        periodTo: '2026-11-23 23:59:59',
        dateRange: '1 Jan 2026 - 23 Nov 2026',
        status: 'failed',
      });
    });

    it('defaults to page 1 and sends no status for All; one day is one legacy date', async () => {
      exchange.listNotificationItems.mockResolvedValue(itemsResponse([]));
      await service.list(TENANT, 'sms', {
        dateFrom: '2026-11-21',
        dateTo: '2026-11-21',
      });
      expect(exchange.listNotificationItems).toHaveBeenCalledWith(
        peer,
        expect.objectContaining({
          contextType: 'sms',
          page: 1,
          periodFrom: '2026-11-21 00:00:00',
          periodTo: '2026-11-21 23:59:59',
          dateRange: '21 Nov 2026',
          status: undefined,
        }),
      );
    });

    it('maps a legacy WhatsApp row and lifts total / page size', async () => {
      exchange.listNotificationItems.mockResolvedValue(
        itemsResponse([legacyWhatsappRow]),
      );
      const page = await service.list(TENANT, 'whatsapp', {
        dateFrom: '2026-11-21',
        dateTo: '2026-11-21',
        page: 1,
      });
      expect(page).toEqual({
        data: [
          {
            id: 51234,
            to: '919800000001',
            template: 'Lab create order, Inform Patient',
            notificationStatus: 'Success',
            deliveryStatus: 'Pending',
            smsParts: null,
            createdAt: '2026-11-21T15:25:00.000Z',
            updatedAt: '2026-11-21T15:26:30.000Z',
          },
        ],
        total: 1563,
        page: 1,
        limit: 50,
      });
      expect(page).not.toHaveProperty('smsPartsCount');
    });

    it('maps every n_status code and keeps unknown ones raw', async () => {
      exchange.listNotificationItems.mockResolvedValue(
        itemsResponse(
          ['100', 200, '300', 400, 999, null].map((n, i) => ({
            ...legacyWhatsappRow,
            id: i + 1,
            n_status: n,
          })),
        ),
      );
      const page = await service.list(TENANT, 'whatsapp', {
        dateFrom: '2026-11-21',
        dateTo: '2026-11-21',
      });
      expect(page.data.map((r) => r.notificationStatus)).toEqual([
        'Pending',
        'Success',
        'Retry',
        'Error',
        '999',
        null,
      ]);
    });

    it('SMS: parts per row and the filtered parts total (top level or under data)', async () => {
      const smsRow = (id: number, part: unknown, status = 'Undelivered') => ({
        id,
        context_id: '919800000002',
        n_status: 200,
        status,
        created_at: '2026-11-18 09:45:00',
        updated_at: '2026-11-18 09:45:00',
        response: JSON.stringify({ msg: 'Hi', response: { part } }),
      });
      exchange.listNotificationItems.mockResolvedValueOnce(
        itemsResponse(
          [smsRow(1, 3), smsRow(2, '2', 'NOT-SENT'), smsRow(3, undefined)],
          { contextPartCount: { sms_count: 559 } },
        ),
      );
      const top = await service.list(TENANT, 'sms', {
        dateFrom: '2026-01-01',
        dateTo: '2026-11-23',
      });
      expect(top.data.map((r) => r.smsParts)).toEqual([3, 2, null]);
      expect(top.data.map((r) => r.deliveryStatus)).toEqual([
        'Undelivered',
        'NOT-SENT',
        'Undelivered',
      ]);
      expect(top.data.every((r) => r.template === null)).toBe(true);
      expect(top.smsPartsCount).toBe(559);

      exchange.listNotificationItems.mockResolvedValueOnce({
        s: 200,
        data: {
          data: [],
          total: '0',
          per_page: '50',
          contextPartCount: { sms_count: '0' },
        },
      });
      const nested = await service.list(TENANT, 'sms', {
        dateFrom: '2026-01-01',
        dateTo: '2026-01-01',
      });
      expect(nested).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 50,
        smsPartsCount: 0,
      });

      exchange.listNotificationItems.mockResolvedValueOnce(itemsResponse([]));
      const missing = await service.list(TENANT, 'sms', {
        dateFrom: '2026-01-01',
        dateTo: '2026-01-01',
      });
      expect(missing.smsPartsCount).toBeNull();
    });

    it('a bad response JSON never breaks the row', async () => {
      exchange.listNotificationItems.mockResolvedValue(
        itemsResponse([{ ...legacyWhatsappRow, response: '{not json' }]),
      );
      const page = await service.list(TENANT, 'whatsapp', {
        dateFrom: '2026-11-21',
        dateTo: '2026-11-21',
      });
      expect(page.data[0]).toMatchObject({ template: null, smsParts: null });
    });

    it('falls back to the local log for a non-phone recipient and a feature label', async () => {
      const logId = '6f2c8a0e-6a3e-4f5e-9d61-0f6d7f0a1b2c';
      exchange.listNotificationItems.mockResolvedValue(
        itemsResponse([
          {
            id: 77,
            context_id: logId,
            n_status: 200,
            status: 'delivered',
            created_at: '2026-11-22 10:00:00',
            updated_at: '2026-11-22 10:01:00',
            response: JSON.stringify({ template_id: '0' }),
          },
        ]),
      );
      findMany.mockResolvedValue([
        {
          exchangeId: '77',
          toAddress: '+919800000003',
          feature: 'lab_report_as_attachment',
          body: 'Your report is attached.',
        },
      ]);
      const page = await service.list(TENANT, 'whatsapp', {
        dateFrom: '2026-11-22',
        dateTo: '2026-11-22',
      });
      expect(findMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT,
          channel: MessagingChannel.WHATSAPP,
          exchangeId: { in: ['77'] },
          deletedAt: null,
        },
        select: {
          exchangeId: true,
          toAddress: true,
          feature: true,
          body: true,
        },
      });
      expect(page.data[0]).toMatchObject({
        to: '+919800000003',
        template: 'Lab Report as Attachment',
      });
    });

    it('skips the local lookup when the page is empty', async () => {
      exchange.listNotificationItems.mockResolvedValue(itemsResponse([]));
      await service.list(TENANT, 'whatsapp', {
        dateFrom: '2026-11-22',
        dateTo: '2026-11-22',
      });
      expect(findMany).not.toHaveBeenCalled();
    });

    it('rejects a reversed range before calling the gateway', async () => {
      await expect(
        service.list(TENANT, 'whatsapp', {
          dateFrom: '2026-11-23',
          dateTo: '2026-11-01',
        }),
      ).rejects.toBeInstanceOf(MessagingReportInvalidDateRangeException);
      expect(exchange.listNotificationItems).not.toHaveBeenCalled();
    });

    it('503 when the gateway is not configured', async () => {
      exchange.isConfigured.mockReturnValue(false);
      await expect(
        service.list(TENANT, 'sms', {
          dateFrom: '2026-11-23',
          dateTo: '2026-11-23',
        }),
      ).rejects.toBeInstanceOf(MessagingGatewayNotConfiguredException);
      expect(resolvePeer).not.toHaveBeenCalled();
    });

    it('propagates a missing Exchange id', async () => {
      resolvePeer.mockRejectedValue(
        new ExchangeTenantIdMissingException(TENANT),
      );
      await expect(
        service.list(TENANT, 'whatsapp', {
          dateFrom: '2026-11-23',
          dateTo: '2026-11-23',
        }),
      ).rejects.toBeInstanceOf(ExchangeTenantIdMissingException);
    });

    it.each([
      ['no answer', null],
      ['an error status', { s: '500', m: 'boom' }],
    ])('502 when the gateway gives %s', async (_label, response) => {
      exchange.listNotificationItems.mockResolvedValue(response);
      await expect(
        service.list(TENANT, 'whatsapp', {
          dateFrom: '2026-11-23',
          dateTo: '2026-11-23',
        }),
      ).rejects.toBeInstanceOf(MessagingGatewayUnavailableException);
    });
  });

  describe('tenant not registered with the gateway', () => {
    const notFound = { s: '403', m: 'client not found!' };

    it('list → 409 MESSAGING_TENANT_NOT_REGISTERED, not a generic 502', async () => {
      exchange.listNotificationItems.mockResolvedValue(notFound);
      await expect(
        service.list(TENANT, 'whatsapp', {
          dateFrom: '2026-11-23',
          dateTo: '2026-11-23',
        }),
      ).rejects.toBeInstanceOf(MessagingTenantNotRegisteredException);
    });

    it('detail → the same', async () => {
      exchange.getNotificationItemDetail.mockResolvedValue(notFound);
      await expect(service.detail(TENANT, 'sms', 1)).rejects.toBeInstanceOf(
        MessagingTenantNotRegisteredException,
      );
    });
  });

  describe('detail', () => {
    it('returns recipient, created time and the message', async () => {
      exchange.getNotificationItemDetail.mockResolvedValue({
        s: '200',
        data: { ...legacyWhatsappRow, peer_tenant_id: EXCHANGE_TENANT_ID },
      });
      await expect(service.detail(TENANT, 'whatsapp', 51234)).resolves.toEqual({
        id: 51234,
        to: '919800000001',
        createdAt: '2026-11-21T15:25:00.000Z',
        message: 'Dear Patient, your order is booked.',
      });
      expect(exchange.getNotificationItemDetail).toHaveBeenCalledWith(
        peer,
        51234,
      );
    });

    it('falls back to the local log body when the gateway has no message', async () => {
      exchange.getNotificationItemDetail.mockResolvedValue({
        s: '200',
        data: { ...legacyWhatsappRow, response: null },
      });
      findMany.mockResolvedValue([
        {
          exchangeId: '51234',
          toAddress: '919800000001',
          feature: null,
          body: 'Local body',
        },
      ]);
      const detail = await service.detail(TENANT, 'whatsapp', 51234);
      expect(detail.message).toBe('Local body');
    });

    it('404 for a message owned by another tenant', async () => {
      exchange.getNotificationItemDetail.mockResolvedValue({
        s: '200',
        data: { ...legacyWhatsappRow, peer_tenant_id: 9999 },
      });
      await expect(
        service.detail(TENANT, 'whatsapp', 51234),
      ).rejects.toBeInstanceOf(MessageNotFoundException);
    });

    it('404 for a message of the other channel', async () => {
      exchange.getNotificationItemDetail.mockResolvedValue({
        s: '200',
        data: { ...legacyWhatsappRow, context_type: 'sms' },
      });
      await expect(
        service.detail(TENANT, 'whatsapp', 51234),
      ).rejects.toBeInstanceOf(MessageNotFoundException);
    });

    it('a non-channel context_type (e.g. communication_log) is not treated as a mismatch', async () => {
      exchange.getNotificationItemDetail.mockResolvedValue({
        s: '200',
        data: { ...legacyWhatsappRow, context_type: 'communication_log' },
      });
      await expect(
        service.detail(TENANT, 'whatsapp', 51234),
      ).resolves.toMatchObject({ id: 51234 });
    });

    it('404 when the gateway does not have it; 502 when it does not answer', async () => {
      exchange.getNotificationItemDetail.mockResolvedValueOnce({
        s: '404',
        data: null,
      });
      await expect(service.detail(TENANT, 'sms', 1)).rejects.toBeInstanceOf(
        MessageNotFoundException,
      );
      exchange.getNotificationItemDetail.mockResolvedValueOnce(null);
      await expect(service.detail(TENANT, 'sms', 1)).rejects.toBeInstanceOf(
        MessagingGatewayUnavailableException,
      );
    });
  });

  describe('helpers', () => {
    it('normaliseGatewayTimestamp reads naive strings as IST and keeps zoned ones', () => {
      expect(normaliseGatewayTimestamp('2026-11-21 20:55:00')).toBe(
        '2026-11-21T15:25:00.000Z',
      );
      expect(normaliseGatewayTimestamp('2026-11-21T00:10')).toBe(
        '2026-11-20T18:40:00.000Z',
      );
      expect(normaliseGatewayTimestamp('2026-11-21T15:25:00Z')).toBe(
        '2026-11-21T15:25:00.000Z',
      );
      expect(normaliseGatewayTimestamp('2026-11-21T20:55:00+05:30')).toBe(
        '2026-11-21T15:25:00.000Z',
      );
      expect(normaliseGatewayTimestamp('')).toBeNull();
      expect(normaliseGatewayTimestamp('yesterday')).toBeNull();
      expect(normaliseGatewayTimestamp(null)).toBeNull();
    });

    it('legacyDateRange matches the old screen’s date_range text', () => {
      expect(legacyDateRange('2026-01-01', '2026-11-23')).toBe(
        '1 Jan 2026 - 23 Nov 2026',
      );
      expect(legacyDateRange('2026-10-31', '2026-10-31')).toBe('31 Oct 2026');
    });
  });
});
