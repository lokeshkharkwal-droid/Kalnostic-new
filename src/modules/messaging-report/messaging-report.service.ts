import { Injectable } from '@nestjs/common';
import { MessagingChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ExchangeClient,
  ExchangeNotificationItem,
  ExchangeNotificationItemsResponse,
} from '../communication/exchange/exchange.client';
import { ExchangeRegistrationService } from '../communication/exchange/exchange-registration.service';
import { MESSAGING_FEATURE_LABELS } from '../template/constants/feature-types';
import { fromBranchLocalInstant } from '../../common/utils/tat-working-time.util';
import {
  EXCHANGE_DEFAULT_PER_PAGE,
  EXCHANGE_GATEWAY_TIME_ZONE,
  MessageDetail,
  MessagingReportChannel,
  MessagingReportPage,
  MessagingReportRow,
  NOTIFICATION_STATUS_LABELS,
} from './entities/messaging-report.types';
import {
  MessageNotFoundException,
  MessagingGatewayNotConfiguredException,
  MessagingGatewayUnavailableException,
  MessagingReportInvalidDateRangeException,
  MessagingTenantNotRegisteredException,
} from './exceptions/messaging-report.exceptions';

/** Filters accepted by {@link MessagingReportService.list} (validated by the DTOs). */
export interface MessagingReportFilters {
  dateFrom: string;
  dateTo: string;
  page?: number;
  status?: string;
}

/** Local `communication_logs` fields used to fill gaps in gateway rows. */
interface LocalLogFields {
  exchangeId: string | null;
  toAddress: string;
  feature: string | null;
  body: string;
}

const PRISMA_CHANNEL: Record<MessagingReportChannel, MessagingChannel> = {
  whatsapp: MessagingChannel.WHATSAPP,
  sms: MessagingChannel.SMS,
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** A recipient that is a phone number (optionally with a leading `+`). */
const PHONE = /^\+?\d{6,15}$/;
/** A gateway timestamp without zone: `YYYY-MM-DD[ T]HH:mm[:ss]`. */
const NAIVE_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;
/** A timestamp that already carries a zone (`Z` or `±hh:mm`). */
const ZONED_TIMESTAMP = /(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Business Admin messaging reports (REPORT → WhatsApp Report / SMS Report).
 *
 * The Exchange gateway delivers every WhatsApp/SMS and keeps the provider's
 * delivery status, so the reports read it from there, exactly like the legacy
 * `subscription/business/whatsAppReport` / `smsReport` screens. Every call is
 * scoped to the caller's own tenant through its `exchangeTenantId`. Local
 * `communication_logs` rows (matched on `exchange_id`) only fill in a recipient
 * or template name the gateway row lacks.
 */
@Injectable()
export class MessagingReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exchange: ExchangeClient,
    private readonly exchangeRegistration: ExchangeRegistrationService,
  ) {}

  /**
   * One page of the tenant's WhatsApp or SMS messages for an inclusive date range,
   * optionally narrowed to one provider delivery status. Newest first, page size
   * fixed by the gateway.
   * @param tenantId tenant scope (from JWT)
   * @param channel `whatsapp` or `sms`
   * @param filters `dateFrom`/`dateTo` (`YYYY-MM-DD`), `page`, optional lower-case `status`
   * @returns `{ data, total, page, limit }` (+ `smsPartsCount` for SMS)
   * @throws MessagingGatewayNotConfiguredException when the gateway env is missing
   * @throws MessagingReportInvalidDateRangeException when `dateFrom > dateTo`
   * @throws ExchangeTenantIdMissingException when the tenant has no Exchange id
   * @throws MessagingTenantNotRegisteredException when the gateway does not know the tenant
   * @throws MessagingGatewayUnavailableException when the gateway errors
   */
  async list(
    tenantId: string,
    channel: MessagingReportChannel,
    filters: MessagingReportFilters,
  ): Promise<MessagingReportPage> {
    this.assertGatewayConfigured();
    const { dateFrom, dateTo } = filters;
    if (dateFrom > dateTo) {
      throw new MessagingReportInvalidDateRangeException(dateFrom, dateTo);
    }
    const page = filters.page ?? 1;
    const { peer } = await this.exchangeRegistration.resolvePeer(tenantId);

    const response = await this.exchange.listNotificationItems(peer, {
      contextType: channel,
      page,
      periodFrom: `${dateFrom} 00:00:00`,
      periodTo: `${dateTo} 23:59:59`,
      dateRange: legacyDateRange(dateFrom, dateTo),
      status: filters.status,
    });
    if (response && isClientNotFound(response)) {
      throw new MessagingTenantNotRegisteredException({ channel });
    }
    if (!response || !this.exchange.isReportOk(response)) {
      throw new MessagingGatewayUnavailableException({
        channel,
        gatewayStatus: response?.s ?? response?.status ?? null,
        gatewayMessage: response?.m ?? null,
      });
    }

    const body = response.data ?? {};
    const items = Array.isArray(body.data) ? body.data : [];
    const local = await this.loadLocalLogs(tenantId, channel, items);
    const result: MessagingReportPage = {
      data: items.map((item) => this.toRow(item, channel, local)),
      total: toCount(body.total) ?? items.length,
      page,
      limit: toPositiveInt(body.per_page) ?? EXCHANGE_DEFAULT_PER_PAGE,
    };
    if (channel === 'sms') {
      result.smsPartsCount = readSmsPartsCount(response);
    }
    return result;
  }

  /**
   * The "Message Detail" pop-up: recipient, created time and the full message.
   * A message the gateway reports as owned by another tenant or channel is
   * treated as not found.
   * @param tenantId tenant scope (from JWT)
   * @param channel `whatsapp` or `sms`
   * @param id Exchange notification id
   * @throws MessagingGatewayNotConfiguredException when the gateway env is missing
   * @throws ExchangeTenantIdMissingException when the tenant has no Exchange id
   * @throws MessagingTenantNotRegisteredException when the gateway does not know the tenant
   * @throws MessagingGatewayUnavailableException when the gateway does not answer
   * @throws MessageNotFoundException when the gateway has no such message for this tenant
   */
  async detail(
    tenantId: string,
    channel: MessagingReportChannel,
    id: number,
  ): Promise<MessageDetail> {
    this.assertGatewayConfigured();
    const { peer, exchangeTenantId } =
      await this.exchangeRegistration.resolvePeer(tenantId);

    const response = await this.exchange.getNotificationItemDetail(peer, id);
    if (!response) {
      throw new MessagingGatewayUnavailableException({ channel, id });
    }
    if (isClientNotFound(response)) {
      throw new MessagingTenantNotRegisteredException({ channel, id });
    }
    const item = response.data;
    if (
      !this.exchange.isReportOk(response) ||
      !item ||
      typeof item !== 'object'
    ) {
      throw new MessageNotFoundException(id, {
        gatewayStatus: response.s ?? response.status ?? null,
      });
    }

    const owner = item.peer_tenant_id;
    if (owner != null && String(owner) !== String(exchangeTenantId)) {
      throw new MessageNotFoundException(id, { reason: 'other tenant' });
    }
    const itemChannel = text(item.context_type)?.toLowerCase();
    if (
      itemChannel &&
      (itemChannel === 'whatsapp' ||
        itemChannel === 'sms' ||
        itemChannel === 'email') &&
      itemChannel !== channel
    ) {
      throw new MessageNotFoundException(id, { reason: 'other channel' });
    }

    const local = await this.loadLocalLogs(tenantId, channel, [item]);
    const log = local.get(String(item.id ?? id));
    const parsed = parseGatewayResponse(item.response);
    return {
      id,
      to: pickRecipient(item, log),
      createdAt: normaliseGatewayTimestamp(item.created_at),
      message: text(parsed.msg) ?? text(item.message) ?? log?.body ?? null,
    };
  }

  /** Throw a clear 503 instead of the gateway client's silent `null`. */
  private assertGatewayConfigured(): void {
    if (!this.exchange.isConfigured()) {
      throw new MessagingGatewayNotConfiguredException();
    }
  }

  /**
   * Local log rows for the given gateway rows, keyed by `exchange_id` (the id the
   * gateway returned when the message was sent). One tenant-scoped query per page.
   */
  private async loadLocalLogs(
    tenantId: string,
    channel: MessagingReportChannel,
    items: ExchangeNotificationItem[],
  ): Promise<Map<string, LocalLogFields>> {
    const ids = [
      ...new Set(
        items
          .map((i) => (i.id == null ? null : String(i.id)))
          .filter((v): v is string => !!v),
      ),
    ];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.communicationLog.findMany({
      where: {
        tenantId,
        channel: PRISMA_CHANNEL[channel],
        exchangeId: { in: ids },
        deletedAt: null,
      },
      select: { exchangeId: true, toAddress: true, feature: true, body: true },
    });
    const map = new Map<string, LocalLogFields>();
    for (const row of rows) {
      if (row.exchangeId) map.set(row.exchangeId, row);
    }
    return map;
  }

  /** Map one gateway row onto a report row. */
  private toRow(
    item: ExchangeNotificationItem,
    channel: MessagingReportChannel,
    local: Map<string, LocalLogFields>,
  ): MessagingReportRow {
    const log = item.id == null ? undefined : local.get(String(item.id));
    const parsed = parseGatewayResponse(item.response);
    const nStatus = item.n_status == null ? null : String(item.n_status);
    return {
      id: toPositiveInt(item.id),
      to: pickRecipient(item, log),
      template: pickTemplate(parsed, item, log),
      notificationStatus: nStatus
        ? (NOTIFICATION_STATUS_LABELS[nStatus] ?? nStatus)
        : null,
      deliveryStatus: text(item.status),
      smsParts: channel === 'sms' ? readParts(parsed) : null,
      createdAt: normaliseGatewayTimestamp(item.created_at),
      updatedAt: normaliseGatewayTimestamp(item.updated_at),
    };
  }
}

/**
 * The gateway's answer for a `peer_tenant_id` it has no client for:
 * `{ "s": "403", "m": "client not found!" }` (seen on staging, 2026-11-23).
 */
function isClientNotFound(response: {
  s?: unknown;
  status?: unknown;
}): boolean {
  return String(response.s ?? response.status) === '403';
}

/** Trimmed non-empty string, else null. */
function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/** Non-negative integer from a number or numeric string, else null. */
function toCount(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

/** Positive integer from a number or numeric string, else null. */
function toPositiveInt(value: unknown): number | null {
  const n = toCount(value);
  return n != null && n > 0 ? n : null;
}

/** The gateway `response` column: a JSON string (or object) — `{}` when unreadable. */
function parseGatewayResponse(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** SMS parts of one message: `response.response.part`. */
function readParts(parsed: Record<string, unknown>): number | null {
  const inner = parsed.response;
  if (!inner || typeof inner !== 'object') return null;
  return toCount((inner as Record<string, unknown>).part);
}

/** SMS parts over the filtered set: `contextPartCount.sms_count` (top level or under `data`). */
function readSmsPartsCount(
  response: ExchangeNotificationItemsResponse,
): number | null {
  const cpc = response.contextPartCount ?? response.data?.contextPartCount;
  return cpc ? toCount(cpc.sms_count) : null;
}

/**
 * Recipient: the gateway's `context_id` when it is a phone number (legacy rows),
 * else the local log's address (newer sends may carry the log id there).
 */
function pickRecipient(
  item: ExchangeNotificationItem,
  log: LocalLogFields | undefined,
): string | null {
  const contextId = text(item.context_id);
  if (contextId && PHONE.test(contextId)) return contextId;
  return log?.toAddress ?? contextId ?? text(item.to);
}

/**
 * Template name: the gateway's `template_id` when it is a name (legacy rows store
 * names such as "Lab create order, Inform Patient"), else the local log's feature
 * label, else null. A purely numeric provider template id is never shown.
 */
function pickTemplate(
  parsed: Record<string, unknown>,
  item: ExchangeNotificationItem,
  log: LocalLogFields | undefined,
): string | null {
  const gateway = text(parsed.template_id) ?? text(item.template_name);
  if (gateway && !/^\d+$/.test(gateway)) return gateway;
  const feature = log?.feature ?? text(item.notification_type);
  if (feature) return MESSAGING_FEATURE_LABELS[feature] ?? feature;
  return null;
}

/**
 * Gateway timestamp → ISO-8601 UTC. Naive `YYYY-MM-DD HH:mm[:ss]` strings are the
 * gateway's local wall clock ({@link EXCHANGE_GATEWAY_TIME_ZONE}); zoned strings
 * are parsed as-is. Unreadable values become null.
 */
export function normaliseGatewayTimestamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const naive = NAIVE_TIMESTAMP.exec(raw);
  if (naive) {
    const [, y, mo, d, h, mi, s] = naive;
    const wallClock = new Date(
      Date.UTC(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h),
        Number(mi),
        Number(s ?? 0),
      ),
    );
    if (Number.isNaN(wallClock.getTime())) return null;
    return fromBranchLocalInstant(
      wallClock,
      EXCHANGE_GATEWAY_TIME_ZONE,
    ).toISOString();
  }
  if (ZONED_TIMESTAMP.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

/** `2026-01-01`,`2026-11-23` → `1 Jan 2026 - 23 Nov 2026` (one day → `21 Nov 2026`), as the legacy screen sent it. */
export function legacyDateRange(dateFrom: string, dateTo: string): string {
  const fmt = (iso: string): string => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[(m ?? 1) - 1] ?? ''} ${y}`;
  };
  return dateFrom === dateTo
    ? fmt(dateFrom)
    : `${fmt(dateFrom)} - ${fmt(dateTo)}`;
}
