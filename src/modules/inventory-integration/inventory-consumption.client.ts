import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getBearerToken } from '../../prisma/tenant-context';

/** Per-product availability returned by the inventory service. */
export interface InventoryProductAvailability {
  productId: string;
  productName: string;
  productCode: string | null;
  requiredQty: number;
  availableQty: number;
  alertQty: number;
  sufficient: boolean;
}

/** Result of a pre-order stock validation. */
export interface InventoryValidateResult {
  hasMapping: boolean;
  ok: boolean;
  proformas: Array<{
    proformaId: string;
    proformaName: string;
    reference: string;
  }>;
  products: InventoryProductAvailability[];
  shortages: Array<{
    productId: string;
    productName: string;
    requiredQty: number;
    availableQty: number;
  }>;
}

/** Result of an inventory consumption (deduction + linked sale). */
export interface InventoryConsumeResult {
  consumed: boolean;
  alreadyConsumed: boolean;
  hasMapping: boolean;
  saleId: string | null;
}

/** One product row in the manual inventory-adjustment view. */
export interface InventoryAdjustmentProduct {
  productId: string;
  productName: string;
  productCode: string | null;
  plannedQty: number;
  previouslyDeductedQty: number;
  currentStock: number;
  finalQtySuggestion: number;
}

/** The manual inventory-adjustment view for an order (ORDER) or one test (TEST). */
export interface InventoryAdjustmentView {
  scope: 'ORDER' | 'TEST';
  kalnosticsOrderId: string;
  labTestSourceId: string | null;
  isAutoDeducted: boolean;
  status: string;
  totalPlannedQty: number;
  products: InventoryAdjustmentProduct[];
}

/** Result of applying a manual inventory adjustment. */
export interface InventoryAdjustmentSaveResult extends InventoryAdjustmentView {
  saleId: string | null;
  applied: Array<{ productId: string; difference: number }>;
}

/** Proforma + product/stock info for a single lab test (tooltip). */
export interface InventoryProformaInfo {
  mapped: boolean;
  proformas: Array<{
    proformaId: string;
    proformaName: string;
    reference: string;
    products: InventoryProductAvailability[];
  }>;
}

interface InventoryEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

/** Raised when the inventory service rejects a call (propagated to the caller). */
export class InventoryUpstreamError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'InventoryUpstreamError';
  }
}

/**
 * Client for the inventory service's proforma-consumption endpoints — the single
 * seam kalnostics-new uses to validate/deduct inventory for a confirmed order and
 * to surface proforma info in registration. Forwards the current request's bearer
 * token (via `tenantContext`) so inventory runs the call as the same business user
 * and under the same tenant/branch. When `INVENTORY_API_BASE_URL` is unset the
 * client is **disabled** and every method is a safe no-op — order creation must
 * never break where the inventory app isn't deployed.
 */
@Injectable()
export class InventoryConsumptionClient {
  private readonly logger = new Logger(InventoryConsumptionClient.name);
  private readonly baseUrl: string | null;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    const raw = config.get<string>('INVENTORY_API_BASE_URL')?.trim();
    this.baseUrl = raw ? raw.replace(/\/+$/, '') : null;
    this.timeoutMs = config.get<number>('INVENTORY_API_TIMEOUT_MS', 15000);
  }

  /** Whether the inventory integration is configured (base URL present). */
  get isEnabled(): boolean {
    return this.baseUrl !== null;
  }

  /** Pre-order stock validation for an order's lab tests. */
  async validate(body: {
    branchId: string;
    labTestSourceIds: string[];
  }): Promise<InventoryValidateResult | null> {
    if (!this.isEnabled) return null;
    return this.request<InventoryValidateResult>(
      'POST',
      '/proforma-consumption/validate',
      body,
    );
  }

  /** Deduct mapped products + record the linked sale (idempotent per order). */
  async consume(body: {
    kalnosticsOrderId: string;
    orderCode?: string;
    branchId: string;
    labTestSourceIds: string[];
    patientId?: string;
    patientName?: string;
    date?: string;
    scope?: 'ORDER' | 'TEST';
  }): Promise<InventoryConsumeResult | null> {
    if (!this.isEnabled) return null;
    return this.request<InventoryConsumeResult>(
      'POST',
      '/proforma-consumption/consume',
      body,
    );
  }

  /** Load the manual inventory-adjustment view (planned/deducted/stock per product). */
  async loadAdjustment(body: {
    kalnosticsOrderId: string;
    branchId: string;
    scope: 'ORDER' | 'TEST';
    labTestSourceId?: string;
    labTestSourceIds: string[];
  }): Promise<InventoryAdjustmentView | null> {
    if (!this.isEnabled) return null;
    return this.request<InventoryAdjustmentView>(
      'POST',
      '/proforma-consumption/adjustment/load',
      body,
    );
  }

  /** Apply a manual inventory adjustment (set final deducted qty per product). */
  async saveAdjustment(body: {
    kalnosticsOrderId: string;
    branchId: string;
    scope: 'ORDER' | 'TEST';
    labTestSourceId?: string;
    labTestSourceIds: string[];
    lines: Array<{ productId: string; finalQty: number }>;
    reason?: string;
    note?: string;
    patientId?: string;
    patientName?: string;
    orderCode?: string;
    date?: string;
  }): Promise<InventoryAdjustmentSaveResult | null> {
    if (!this.isEnabled) return null;
    return this.request<InventoryAdjustmentSaveResult>(
      'POST',
      '/proforma-consumption/adjustment/save',
      body,
    );
  }

  /** Proforma + product/stock info for a single lab test (registration tooltip). */
  async info(
    branchId: string,
    labTestSourceId: string,
  ): Promise<InventoryProformaInfo | null> {
    if (!this.isEnabled) return null;
    const qs = new URLSearchParams({ branchId, labTestSourceId }).toString();
    return this.request<InventoryProformaInfo>(
      'GET',
      `/proforma-consumption/info?${qs}`,
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const token = getBearerToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      this.logger.error(`inventory ${method} ${url} failed: ${String(err)}`);
      throw new InventoryUpstreamError(
        'The inventory service did not respond.',
        'INVENTORY_UNREACHABLE',
        502,
      );
    } finally {
      clearTimeout(timer);
    }

    let envelope: InventoryEnvelope<T> | undefined;
    try {
      envelope = (await response.json()) as InventoryEnvelope<T>;
    } catch {
      envelope = undefined;
    }

    if (!response.ok || !envelope?.success) {
      const code = envelope?.error?.code ?? `HTTP_${response.status}`;
      const message =
        envelope?.error?.message ??
        `inventory ${method} ${path} → ${response.status}`;
      throw new InventoryUpstreamError(message, code, response.status);
    }
    return envelope.data as T;
  }
}
