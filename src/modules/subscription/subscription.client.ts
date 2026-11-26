import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Client for the external **Subscription** microservice — a faithful port of the
 * legacy EzHealthTrack `Subscription` model (`_getApi` / `_postApi`), which the
 * `businessSubscription` screen used to register a business and read its plan /
 * bills. The Subscription server is a separate billing product (plans, orders,
 * bills, invoices); Kalnostics owns none of that data and only proxies to it.
 *
 * Every call is a signed request to `SUBSCRIPTION_API_URL` authenticated with the
 * `key` / `secret` headers. Writes (`/clients`, `/orders`) carry the same envelope
 * the Exchange gateway uses:
 *
 *   { data: { key, secret, peer_tenant_id, peer_branch_id, peer_tenant_info,
 *             peer_server_url, peer_branch_info, data: <params> } }
 *
 * Reads (`/clients/show`, `/plans`, `/bills`) send only the signed headers plus a
 * query string. The server answers with `{ s, m, data: { original } }` where
 * `s === '200'` means success (see {@link isOk}); list payloads live in
 * `data.original.data`. When `SUBSCRIPTION_API_URL` is unset the client is
 * **disabled** ({@link isConfigured} is false) and the service surfaces a clear
 * `SUBSCRIPTION_NOT_CONFIGURED` error rather than rendering a broken page.
 */
@Injectable()
export class SubscriptionClient {
  private readonly logger = new Logger(SubscriptionClient.name);

  constructor(private readonly config: ConfigService) {}

  /** Whether the subscription integration is configured (url + key + secret). */
  isConfigured(): boolean {
    return !!(
      this.config.get<string>('subscription.url') &&
      this.config.get<string>('subscription.key') &&
      this.config.get<string>('subscription.secret')
    );
  }

  /** Was the call accepted? The server returns `s === '200'` on success. */
  isOk(resp: SubscriptionEnvelope | null): boolean {
    return !!resp && String(resp.s) === '200';
  }

  /**
   * Fetch the business's current subscription client record (`GET /clients/show`).
   * @param peer tenant context (`peer.tenantId` = the integer subscription business id)
   * @param businessId the integer id the subscription server keys the client by
   */
  async getClient(
    peer: SubscriptionPeer,
    businessId: number,
  ): Promise<SubscriptionEnvelope | null> {
    return this.request(
      'GET',
      `/clients/show?business_id=${businessId}`,
      peer.tenantId,
    );
  }

  /**
   * Register the business as a client on the subscription server (`POST /clients`).
   * This is the "Register Subscription" action — the prerequisite that unlocks
   * plans and bills. Mirrors the legacy `registerBusinessSubscription` payload.
   * @param peer tenant context for the envelope
   * @param params the business details (name / address / contact / pan / gst / business id)
   */
  async registerClient(
    peer: SubscriptionPeer,
    params: RegisterSubscriptionParams,
  ): Promise<SubscriptionEnvelope | null> {
    return this.request(
      'POST',
      '/clients',
      peer.tenantId,
      this.envelope(peer, params),
    );
  }

  /** Fetch the active subscription plans (`GET /plans`). */
  async getPlans(peer: SubscriptionPeer): Promise<SubscriptionEnvelope | null> {
    return this.request('GET', '/plans', peer.tenantId);
  }

  /**
   * Assign / change the business's plan (`POST /orders`). Mirrors the legacy
   * `changeBusinessSubscriptionPlan` payload.
   * @param peer tenant context for the envelope
   * @param params the plan selection (business id + plan id/code + set-default flag)
   */
  async changePlan(
    peer: SubscriptionPeer,
    params: ChangePlanParams,
  ): Promise<SubscriptionEnvelope | null> {
    return this.request(
      'POST',
      '/orders',
      peer.tenantId,
      this.envelope(peer, params),
    );
  }

  /** Fetch the business's subscription bills (`GET /bills`). */
  async getBills(
    peer: SubscriptionPeer,
    businessId: number,
  ): Promise<SubscriptionEnvelope | null> {
    return this.request(
      'GET',
      `/bills?business_id=${businessId}`,
      peer.tenantId,
    );
  }

  /**
   * Fetch one subscription bill as JSON (`GET /bills/json`). The bill is returned
   * on the top-level `bill_json` field, not under `data.original`.
   * @param peer tenant context
   * @param billId the bill id
   * @param businessId the integer subscription business id
   */
  async getBill(
    peer: SubscriptionPeer,
    billId: string,
    businessId: number,
  ): Promise<SubscriptionEnvelope | null> {
    return this.request(
      'GET',
      `/bills/json?id=${encodeURIComponent(billId)}&business_id=${businessId}&format=json`,
      peer.tenantId,
    );
  }

  /**
   * Download one subscription bill as a PDF (`GET /bills/pdf`). Returns the raw
   * PDF bytes (the server streams `application/pdf`, not the JSON envelope).
   * @param peer tenant context
   * @param billId the bill id
   * @param businessId the integer subscription business id
   */
  async downloadBill(
    peer: SubscriptionPeer,
    billId: string,
    businessId: number,
  ): Promise<Buffer> {
    const base = this.baseUrl();
    if (!base) {
      throw new SubscriptionUpstreamError(
        'The subscription service is not configured.',
        'SUBSCRIPTION_NOT_CONFIGURED',
        503,
      );
    }
    const endpoint = `${base}/bills/pdf?id=${encodeURIComponent(billId)}&business_id=${businessId}&format=pdf`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'GET',
        headers: this.signedHeaders(peer.tenantId),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `subscription GET bill pdf failed (${endpoint}): ${message}`,
      );
      throw new SubscriptionUpstreamError(
        'The subscription service did not respond.',
        'SUBSCRIPTION_UNREACHABLE',
        502,
      );
    }
    if (!res.ok) {
      throw new SubscriptionUpstreamError(
        `subscription GET /bills/pdf → ${res.status}`,
        `HTTP_${res.status}`,
        res.status,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** Build the signed write envelope ({@link RegisterSubscriptionParams} / {@link ChangePlanParams}). */
  private envelope(
    peer: SubscriptionPeer,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const key = this.config.get<string>('subscription.key') ?? '';
    const secret = this.config.get<string>('subscription.secret') ?? '';
    return {
      data: {
        key,
        secret,
        peer_tenant_id: peer.tenantId,
        peer_branch_id: peer.branchId ?? '',
        peer_tenant_info: peer.tenantInfo ?? '',
        peer_server_url:
          peer.serverUrl ??
          this.config.get<string>('subscription.frontendUrl') ??
          '',
        peer_branch_info: peer.branchInfo ?? '',
        data: params,
      },
    };
  }

  /** The configured subscription base URL with any trailing slash stripped, or null. */
  private baseUrl(): string | null {
    const raw = this.config.get<string>('subscription.url')?.trim();
    return raw ? raw.replace(/\/+$/, '') : null;
  }

  /** The signed headers every subscription call carries. */
  private signedHeaders(peerTenantId: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      key: this.config.get<string>('subscription.key') ?? '',
      secret: this.config.get<string>('subscription.secret') ?? '',
      peer_tenant_id: peerTenantId,
    };
  }

  /** Per-attempt HTTP timeout (ms). */
  private timeoutMs(): number {
    return this.config.get<number>('subscription.timeoutMs', 15000);
  }

  /**
   * Shared JSON transport: signs the request, bounds it by the configured timeout,
   * and parses the `{ s, m, data }` envelope. Throws {@link SubscriptionUpstreamError}
   * on a transport failure so the caller can surface an actionable error.
   * @param method HTTP method
   * @param path resource path appended to the base URL (may include a query string)
   * @param peerTenantId the integer subscription business id, stamped as `peer_tenant_id`
   * @param body optional JSON envelope (POST)
   */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    peerTenantId: string,
    body?: unknown,
  ): Promise<SubscriptionEnvelope | null> {
    const base = this.baseUrl();
    if (!base) {
      throw new SubscriptionUpstreamError(
        'The subscription service is not configured.',
        'SUBSCRIPTION_NOT_CONFIGURED',
        503,
      );
    }
    const endpoint = `${base}${path}`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method,
        headers: this.signedHeaders(peerTenantId),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `subscription ${method} ${endpoint} failed: ${message}`,
      );
      throw new SubscriptionUpstreamError(
        'The subscription service did not respond.',
        'SUBSCRIPTION_UNREACHABLE',
        502,
      );
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as SubscriptionEnvelope;
    } catch {
      return null;
    }
  }
}

/** Raised when the subscription service is unreachable or rejects a transport call. */
export class SubscriptionUpstreamError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SubscriptionUpstreamError';
  }
}

/**
 * Parsed subscription server response. `s === '200'` ⇒ accepted (see
 * {@link SubscriptionClient.isOk}); the record/plans/bills live in `data.original`
 * (`data.original.data` for lists). A single bill-as-JSON comes back on `bill_json`.
 */
export interface SubscriptionEnvelope {
  s?: string | number;
  m?: string;
  data?: { original?: Record<string, unknown> } & Record<string, unknown>;
  bill_json?: unknown;
  [key: string]: unknown;
}

/** `/clients` registration parameters (the inner `data` object of the envelope). */
export interface RegisterSubscriptionParams {
  name: string;
  code: string;
  address: string;
  address_2: string;
  city: string;
  country: string;
  postcode: string;
  contact_email: string;
  contact_phone: string;
  contact_person: string;
  pan_number: string;
  gst_number: string;
  gst_state: string;
  /** Integer id the subscription server keys the client by. */
  business_id: number;
  [key: string]: unknown;
}

/** `/orders` plan-change parameters. */
export interface ChangePlanParams {
  business_id: number;
  plan_id: string;
  plan_code: string;
  /** '1' to make the plan the business default, '0' otherwise. */
  set_default: string;
  [key: string]: unknown;
}

/** Tenant/branch context stamped onto the signed envelope. */
export interface SubscriptionPeer {
  tenantId: string;
  branchId?: string | null;
  tenantInfo?: string;
  branchInfo?: string;
  serverUrl?: string;
}
