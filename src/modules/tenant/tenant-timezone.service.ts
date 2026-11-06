import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SUPPORTED_TIMEZONES } from './dto/tenant-settings.dto';
import { TenantSettings } from './entities/tenant.entity';

/** Platform default when a tenant has no (or an unsupported) configured zone. Mirrors `TenantService.DEFAULT_SETTINGS.timezone`. */
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** How long a resolved zone is cached. A business's zone is site-admin config that changes very rarely, so a short TTL avoids a DB read on every slot match while still picking up a change within a minute. */
const CACHE_TTL_MS = 60_000;

/**
 * Resolves a tenant's configured IANA time zone (`Tenant.settings.timezone`) for
 * the appointment/scheduling layer, which must convert between the stored UTC
 * instant and the business-local wall clock using the **same** zone the frontend
 * displays with (`GET /tenant/locale`). Kept deliberately tiny and dependency-free
 * (only `PrismaService`) so it can be injected into the slot/order/collection
 * services without a heavyweight `TenantService` dependency or a circular import
 * (CLAUDE.md rule #3). Reads are cached with a short TTL since the zone rarely
 * changes. Falls back to the platform default, exactly like `TenantService.getLocale`.
 */
@Injectable()
export class TenantTimeZoneService {
  private readonly cache = new Map<
    string,
    { zone: string; expiresAt: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The tenant's effective IANA time zone (e.g. `Asia/Kolkata`). Returns the
   * platform default when the tenant is missing, has no `settings.timezone`, or
   * the stored zone is not in {@link SUPPORTED_TIMEZONES}.
   *
   * When called from inside a transaction (e.g. `SlotReservationService`), pass
   * that transaction's client as `client` so the zone read runs on the **same**
   * connection — opening a separate `PrismaService` connection per concurrent
   * reservation would exhaust the pool. Cache hits skip the read entirely.
   * @param tenantId tenant scope
   * @param client optional Prisma client (defaults to the base `PrismaService`)
   */
  async getTimeZone(
    tenantId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string> {
    const now = Date.now();
    const hit = this.cache.get(tenantId);
    if (hit && hit.expiresAt > now) return hit.zone;

    const tenant = await client.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const stored = (tenant?.settings as Partial<TenantSettings> | null)
      ?.timezone;
    const zone =
      stored && (SUPPORTED_TIMEZONES as readonly string[]).includes(stored)
        ? stored
        : DEFAULT_TIMEZONE;
    this.cache.set(tenantId, { zone, expiresAt: now + CACHE_TTL_MS });
    return zone;
  }
}
