import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotFoundException } from '../../../common/exceptions/kaltros.exception';
import { ExchangeClient, ExchangePeer } from './exchange.client';
import {
  ExchangeRegistrationFailedException,
  ExchangeTenantIdMissingException,
} from './exceptions/exchange-registration.exceptions';

/** Outcome of registering a single tenant. */
export interface ExchangeRegistrationResult {
  tenantId: string;
  exchangeTenantId: number | null;
  /** `registered` = a fresh registration; `already_registered` = idempotent no-op. */
  status: 'registered' | 'already_registered';
  exchangeClientId: string | null;
}

/** Aggregate outcome of a bulk registration run. */
export interface ExchangeBulkRegistrationResult {
  registered: number;
  failed: number;
  failures: Array<{ tenantId: string; error: string }>;
}

/** The `Tenant` fields the registration flow needs. */
const TENANT_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  shortName: true,
  exchangeTenantId: true,
  exchangeRegisteredAt: true,
  exchangeClientId: true,
} as const;

/**
 * Registers tenants as clients on the external Exchange server (the `POST /clients`
 * step the legacy `businessExchange` screen performed) so the Exchange can
 * attribute per-tenant message counts to `peer_tenant_id`. Reuses each tenant's
 * existing `exchangeTenantId` (never fabricates an id) and records registration
 * state locally so the action is idempotent. Reads `Tenant` directly via Prisma;
 * `Tenant` is platform-level (no RLS).
 */
@Injectable()
export class ExchangeRegistrationService {
  private readonly logger = new Logger(ExchangeRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exchange: ExchangeClient,
  ) {}

  /**
   * Register one tenant with the Exchange. Idempotent: a tenant that is already
   * registered (`exchangeRegisteredAt` set) is a no-op. Never changes
   * `exchangeTenantId`/`legacyTenantId`.
   * @param tenantId the tenant's UUID
   * @throws NotFoundException if the tenant does not exist
   * @throws ExchangeTenantIdMissingException if the tenant has no `exchangeTenantId`
   * @throws ExchangeRegistrationFailedException if the Exchange rejects the call
   */
  async registerTenant(tenantId: string): Promise<ExchangeRegistrationResult> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: TENANT_SELECT,
    });
    if (!tenant) {
      throw new NotFoundException('tenant', tenantId);
    }
    if (tenant.exchangeRegisteredAt) {
      return {
        tenantId,
        exchangeTenantId: tenant.exchangeTenantId,
        status: 'already_registered',
        exchangeClientId: tenant.exchangeClientId,
      };
    }
    if (tenant.exchangeTenantId == null) {
      throw new ExchangeTenantIdMissingException(tenantId);
    }

    const peer: ExchangePeer = {
      tenantId: String(tenant.exchangeTenantId),
      tenantInfo: tenant.name,
    };
    const response = await this.exchange.registerClient(peer, {
      name: tenant.name,
      code: tenant.shortName ?? '',
      customerEmail: tenant.email,
      customerPhone: tenant.phone,
      businessId: tenant.exchangeTenantId,
    });
    if (!this.exchange.isClientOk(response)) {
      throw new ExchangeRegistrationFailedException(tenantId, {
        exchangeTenantId: tenant.exchangeTenantId,
        response: response ?? null,
      });
    }

    const original = response?.data?.original;
    const rawClientId = original?.id;
    const exchangeClientId =
      typeof rawClientId === 'string' || typeof rawClientId === 'number'
        ? String(rawClientId)
        : null;
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        exchangeRegisteredAt: new Date(),
        exchangeClientId,
        exchangeRegistrationMeta: (original ??
          Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });

    return {
      tenantId,
      exchangeTenantId: tenant.exchangeTenantId,
      status: 'registered',
      exchangeClientId,
    };
  }

  /**
   * Register every tenant that has an `exchangeTenantId` but is not yet
   * registered. Sequential; per-tenant failures are logged and counted (they do
   * not abort the batch). Idempotent — already-registered tenants are excluded
   * by the query.
   */
  async registerAllUnregistered(): Promise<ExchangeBulkRegistrationResult> {
    const pending = await this.prisma.tenant.findMany({
      where: {
        exchangeTenantId: { not: null },
        exchangeRegisteredAt: null,
        deletedAt: null,
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const result: ExchangeBulkRegistrationResult = {
      registered: 0,
      failed: 0,
      failures: [],
    };
    for (const t of pending) {
      try {
        const r = await this.registerTenant(t.id);
        if (r.status === 'registered') result.registered += 1;
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        this.logger.error(`Exchange registration failed for ${t.id}: ${error}`);
        result.failed += 1;
        result.failures.push({ tenantId: t.id, error });
      }
    }
    return result;
  }

  /**
   * Fetch a tenant's current Exchange client record (`GET /clients/show`).
   * @param tenantId the tenant's UUID
   * @throws NotFoundException / ExchangeTenantIdMissingException as for registration
   */
  async getStatus(tenantId: string): Promise<Record<string, unknown> | null> {
    const { exchangeTenantId, peer } = await this.resolvePeer(tenantId);
    const response = await this.exchange.getClientStatus(
      peer,
      exchangeTenantId,
    );
    return response?.data?.original ?? null;
  }

  /**
   * Fetch a tenant's Exchange usage/billing counts (`GET /clientsbilling/show`).
   * @param tenantId the tenant's UUID
   * @throws NotFoundException / ExchangeTenantIdMissingException as for registration
   */
  async getUsage(tenantId: string): Promise<unknown> {
    const { exchangeTenantId, peer } = await this.resolvePeer(tenantId);
    const response = await this.exchange.getClientBilling(
      peer,
      exchangeTenantId,
    );
    return response?.data ?? null;
  }

  /**
   * Load a tenant and build the Exchange peer context from its `exchangeTenantId`.
   * @param tenantId the tenant's UUID
   */
  private async resolvePeer(
    tenantId: string,
  ): Promise<{ exchangeTenantId: number; peer: ExchangePeer }> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: { id: true, name: true, exchangeTenantId: true },
    });
    if (!tenant) {
      throw new NotFoundException('tenant', tenantId);
    }
    if (tenant.exchangeTenantId == null) {
      throw new ExchangeTenantIdMissingException(tenantId);
    }
    return {
      exchangeTenantId: tenant.exchangeTenantId,
      peer: {
        tenantId: String(tenant.exchangeTenantId),
        tenantInfo: tenant.name,
      },
    };
  }
}
