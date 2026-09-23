import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Exchange messaging gateway client — a faithful port of the legacy Kishan
 * `messaging-api.ts` (`sendEmailViaExchange` / `sendSmsViaExchange` /
 * `sendWhatsappViaExchange`), which in turn mirrored the PHP `Msg::_send*ViaEzApi`
 * helpers.
 *
 * Kalnostics does NOT integrate any provider SDK. Every outbound Email / SMS /
 * WhatsApp is delegated to the external Exchange server via ONE signed POST to
 * `EXCHANGE_API_URL + '/notifications'` with the envelope:
 *
 *   { data: { key, secret, peer_tenant_id, peer_branch_id, peer_tenant_info,
 *             peer_server_url, peer_branch_info, request_params,
 *             data: [ <notification> ] } }
 *
 * Contract preserved exactly from Kishan: email `subject`/`body` are base64
 * encoded, SMS strips a leading `+`, and a call is "OK" when the response has a
 * non-null `id` ({@link isOk}). When the `EXCHANGE_API_*` env vars are missing (a
 * dev box with no gateway) every send is a graceful no-op returning `null`, so
 * the queue worker marks the row failed/retried rather than crashing.
 */
@Injectable()
export class ExchangeClient {
  private readonly logger = new Logger(ExchangeClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Send an email through the Exchange gateway. Subject + body are base64-encoded
   * per the gateway contract; attachments must already be base64-encoded in `data`.
   * @param peer tenant/branch context for the envelope
   * @param params recipient, subject, body, optional attachments
   * @param reqParams verbatim `request_params` (notification_type/context…)
   * @returns the parsed gateway response, or null when unconfigured/errored
   */
  async sendEmail(
    peer: ExchangePeer,
    params: SendEmailParams,
    reqParams: Record<string, unknown> = {},
  ): Promise<ExchangeResponse | null> {
    // A blank `from` is silently DROPPED by the relay (confirmed: emails only
    // deliver when a sender is present). Fall back to the configured default
    // sender so every email carries a valid from/fromName.
    const notification = {
      type: 'email',
      to: params.to,
      toName: params.toName ?? '',
      from: params.from || this.config.get<string>('exchange.fromEmail') || '',
      fromName:
        params.fromName || this.config.get<string>('exchange.fromName') || '',
      subject: Buffer.from(params.subject, 'utf8').toString('base64'),
      body: Buffer.from(params.body, 'utf8').toString('base64'),
      attachments: params.attachments ?? false,
    };
    return this.post(peer, notification, reqParams);
  }

  /**
   * Send a WhatsApp message through the Exchange gateway. Message stays plain text.
   * @param peer tenant/branch context for the envelope
   * @param params recipient, message, template metadata, optional attachments
   * @param reqParams verbatim `request_params`
   * @returns the parsed gateway response, or null when unconfigured/errored
   */
  async sendWhatsapp(
    peer: ExchangePeer,
    params: SendWhatsappParams,
    reqParams: Record<string, unknown> = {},
  ): Promise<ExchangeResponse | null> {
    const notification = {
      type: 'whatsapp',
      to: params.to,
      message: params.message,
      sms_template_id: params.smsTemplateId ?? '0',
      sms_sender_id: params.smsSenderId ?? '',
      sms_type: params.smsType ?? '',
      template_category: params.templateCategory ?? 'utility',
      template_params: params.templateParams ?? '',
      attachments: params.attachments ?? false,
      context_name: params.contextName ?? '',
    };
    return this.post(peer, notification, reqParams);
  }

  /**
   * Send an SMS through the Exchange gateway. Strips a leading `+` so the gateway
   * accepts the number unchanged (legacy behaviour).
   * @param peer tenant/branch context for the envelope
   * @param params recipient, message, DLT template metadata
   * @param reqParams verbatim `request_params`
   * @returns the parsed gateway response, or null when unconfigured/errored
   */
  async sendSms(
    peer: ExchangePeer,
    params: SendSmsParams,
    reqParams: Record<string, unknown> = {},
  ): Promise<ExchangeResponse | null> {
    const to = params.to.startsWith('+') ? params.to.slice(1) : params.to;
    const notification = {
      type: 'sms',
      to,
      message: params.message,
      sms_template_id: params.smsTemplateId ?? '0',
      sms_sender_id: params.smsSenderId ?? '',
      sms_type: params.smsType ?? 'Promotional',
      message_type: params.messageType ?? 'TXN',
    };
    return this.post(peer, notification, reqParams);
  }

  /**
   * Was the call accepted? Legacy treats a non-null `id` in the response as success.
   * @param resp a gateway response (or null)
   */
  isOk(resp: ExchangeResponse | null): boolean {
    return !!resp && resp.id != null;
  }

  /**
   * Whether the gateway is configured (all three EXCHANGE_API_* vars present).
   * When false, sends are intentional no-ops.
   */
  isConfigured(): boolean {
    return !!(
      this.config.get<string>('exchange.url') &&
      this.config.get<string>('exchange.key') &&
      this.config.get<string>('exchange.secret')
    );
  }

  /**
   * Build the signed envelope and POST it to `EXCHANGE_API_URL/notifications`.
   * Returns null (never throws) when unconfigured or on any upstream/transport
   * error, so callers degrade gracefully.
   * @param peer tenant/branch context
   * @param notification the single channel-specific notification object
   * @param reqParams verbatim `request_params`
   */
  private async post(
    peer: ExchangePeer,
    notification: Record<string, unknown>,
    reqParams: Record<string, unknown>,
  ): Promise<ExchangeResponse | null> {
    const url = this.config.get<string>('exchange.url');
    const key = this.config.get<string>('exchange.key');
    const secret = this.config.get<string>('exchange.secret');
    if (!url || !key || !secret) return null;

    const envelope = {
      data: {
        key,
        secret,
        peer_tenant_id: peer.tenantId,
        peer_branch_id: peer.branchId ?? '',
        peer_tenant_info: peer.tenantInfo ?? '',
        peer_server_url:
          peer.serverUrl ??
          this.config.get<string>('exchange.frontendUrl') ??
          '',
        peer_branch_info: peer.branchInfo ?? '',
        // Kishan mirrors notification_type at the envelope level too.
        notification_type: (reqParams.notification_type as string) ?? '',
        request_params: reqParams,
        data: [notification],
      },
    };

    // Accept either a base URL (…/social/api/v1) or the full endpoint
    // (…/notifications) in EXCHANGE_API_URL — append the path only if absent so
    // we never post to …/notifications/notifications.
    const endpoint = `${this.baseUrl(url)}/notifications`;
    // Fail fast: a relay that accepts the TCP connection but never responds
    // (a hung/blackholing gateway) must NOT block the queue worker's drain loop.
    // `EXCHANGE_TIMEOUT_MS` bounds every attempt (default 15s); the row simply
    // fails this attempt and is retried on a later tick.
    const timeoutMs = this.config.get<number>('exchange.timeoutMs', 15000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      try {
        return JSON.parse(text) as ExchangeResponse;
      } catch {
        return null;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Exchange POST failed (${endpoint}): ${message}`);
      return null;
    }
  }

  /**
   * Normalise `EXCHANGE_API_URL` to the gateway base (…/social/api/v1). Accepts
   * either the base or the full `…/notifications` URL and strips a trailing
   * `/notifications` (and any trailing slash) so resource paths like `/clients`
   * and `/notifications` can be appended cleanly.
   * @param url the configured `EXCHANGE_API_URL`
   */
  private baseUrl(url: string): string {
    return url.replace(/\/$/, '').replace(/\/notifications$/, '');
  }

  /**
   * Register a tenant as a client on the Exchange server (`POST /clients`). This
   * is the prerequisite that lets the Exchange attribute per-tenant message
   * counts to `peer_tenant_id`. Mirrors the legacy `Exchange::registerBusinessExchange`
   * envelope. Returns the parsed response, or null when unconfigured/errored.
   * @param peer tenant context; `peer.tenantId` is the integer `exchangeTenantId`
   * @param params the client details (name / code / contact / business id)
   */
  async registerClient(
    peer: ExchangePeer,
    params: RegisterClientParams,
  ): Promise<ExchangeClientResponse | null> {
    const url = this.config.get<string>('exchange.url');
    const key = this.config.get<string>('exchange.key');
    const secret = this.config.get<string>('exchange.secret');
    if (!url || !key || !secret) return null;

    const envelope = {
      data: {
        key,
        secret,
        peer_tenant_id: peer.tenantId,
        peer_branch_id: peer.branchId ?? '',
        peer_tenant_info: peer.tenantInfo ?? '',
        peer_server_url:
          peer.serverUrl ??
          this.config.get<string>('exchange.frontendUrl') ??
          '',
        peer_branch_info: peer.branchInfo ?? '',
        data: {
          name: params.name,
          code: params.code ?? '',
          customer_email: params.customerEmail ?? '',
          customer_phone: params.customerPhone ?? '',
          key,
          secret,
          business_id: params.businessId,
        },
      },
    };
    return this.request<ExchangeClientResponse>(
      'POST',
      `${this.baseUrl(url)}/clients`,
      peer.tenantId,
      envelope,
    );
  }

  /**
   * Fetch a tenant's current Exchange client record (`GET /clients/show`).
   * @param peer tenant context (`peer.tenantId` = integer `exchangeTenantId`)
   * @param businessId the integer id the Exchange knows the client by
   */
  async getClientStatus(
    peer: ExchangePeer,
    businessId: number,
  ): Promise<ExchangeClientResponse | null> {
    const url = this.config.get<string>('exchange.url');
    if (!url) return null;
    return this.request<ExchangeClientResponse>(
      'GET',
      `${this.baseUrl(url)}/clients/show?business_id=${businessId}`,
      peer.tenantId,
    );
  }

  /**
   * Fetch a tenant's Exchange usage/billing counts (`GET /clientsbilling/show`).
   * @param peer tenant context (`peer.tenantId` = integer `exchangeTenantId`)
   * @param businessId the integer id the Exchange knows the client by
   */
  async getClientBilling(
    peer: ExchangePeer,
    businessId: number,
  ): Promise<ExchangeClientResponse | null> {
    const url = this.config.get<string>('exchange.url');
    if (!url) return null;
    return this.request<ExchangeClientResponse>(
      'GET',
      `${this.baseUrl(url)}/clientsbilling/show?sbusiness_id=${businessId}`,
      peer.tenantId,
    );
  }

  /**
   * Was a `/clients` call accepted? The Exchange returns `s === '200'` on success.
   * @param resp a client response (or null)
   */
  isClientOk(resp: ExchangeClientResponse | null): boolean {
    return !!resp && String(resp.s) === '200';
  }

  /**
   * Shared transport for the `/clients*` endpoints: sends the signed headers,
   * bounds the attempt by `EXCHANGE_TIMEOUT_MS`, and never throws (returns null
   * on any transport/parse error) so callers degrade gracefully.
   * @param method HTTP method
   * @param endpoint fully-built URL
   * @param peerTenantId the integer tenant id, stamped as the `peer_tenant_id` header
   * @param body optional JSON body (POST)
   */
  private async request<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    peerTenantId: string,
    body?: unknown,
  ): Promise<T | null> {
    const key = this.config.get<string>('exchange.key') ?? '';
    const secret = this.config.get<string>('exchange.secret') ?? '';
    const timeoutMs = this.config.get<number>('exchange.timeoutMs', 15000);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          key,
          secret,
          peer_tenant_id: peerTenantId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Exchange ${method} failed (${endpoint}): ${message}`);
      return null;
    }
  }
}

/** Parsed Exchange gateway response. `id` present ⇒ accepted (see {@link ExchangeClient.isOk}). */
export interface ExchangeResponse {
  id?: string | number | null;
  [key: string]: unknown;
}

/**
 * Parsed Exchange `/clients*` response. `s === '200'` ⇒ accepted (see
 * {@link ExchangeClient.isClientOk}); the registered/queried record is in
 * `data.original`.
 */
export interface ExchangeClientResponse {
  s?: string | number;
  m?: string;
  data?: { original?: Record<string, unknown> } & Record<string, unknown>;
  [key: string]: unknown;
}

/** `/clients` registration parameters (the inner `data` object of the envelope). */
export interface RegisterClientParams {
  /** Business display name. */
  name: string;
  /** Optional short code (legacy sends ''). */
  code?: string;
  /** Contact email. */
  customerEmail?: string | null;
  /** Contact phone. */
  customerPhone?: string | null;
  /** Integer id the Exchange keys the client by (= `exchangeTenantId`). */
  businessId: number;
}

/** Base64-encoded attachment, per the Exchange contract. */
export interface ExchangeAttachment {
  /** Base64-encoded file contents. */
  data: string;
  /** File name shown to the recipient. */
  name: string;
  /** MIME type (e.g. application/pdf). */
  type: string;
}

/** Tenant/branch context stamped onto the envelope. */
export interface ExchangePeer {
  tenantId: string;
  branchId?: string | null;
  tenantInfo?: string;
  branchInfo?: string;
  serverUrl?: string;
}

/** Email send parameters. */
export interface SendEmailParams {
  to: string;
  toName?: string;
  from?: string;
  fromName?: string;
  subject: string;
  body: string;
  attachments?: ExchangeAttachment[];
}

/** WhatsApp send parameters. */
export interface SendWhatsappParams {
  to: string;
  message: string;
  smsTemplateId?: string;
  smsSenderId?: string;
  smsType?: string;
  templateCategory?: string;
  templateParams?: string[];
  contextName?: string;
  attachments?: ExchangeAttachment[];
}

/** SMS send parameters. */
export interface SendSmsParams {
  to: string;
  message: string;
  smsTemplateId?: string;
  smsSenderId?: string;
  smsType?: string;
  messageType?: string;
}
