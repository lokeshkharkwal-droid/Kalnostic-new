import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** PlatformCounter row key for the Exchange tenant-id sequence. */
export const EXCHANGE_TENANT_ID_COUNTER_KEY = 'exchange_tenant_id';

/** Result of a backfill run (see {@link ExchangeTenantIdService.backfillAll}). */
export interface ExchangeIdBackfillResult {
  /** High-water mark the counter was seeded to. */
  floor: number;
  /** Migrated tenants whose exchangeTenantId was set from legacyTenantId. */
  migrated: number;
  /** Native tenants that received a freshly-allocated id. */
  native: number;
}

/**
 * Minimal transaction-client surface this service needs. Accepting a narrowed
 * `Prisma.TransactionClient` lets callers pass their own active `tx` (so the
 * counter update joins the caller's transaction) and keeps the service testable.
 */
export type ExchangeIdTx = Pick<
  Prisma.TransactionClient,
  'platformCounter' | 'tenant'
>;

/**
 * Owns the global, monotonic Exchange tenant-id sequence. All methods operate on
 * a caller-supplied transaction so allocation is atomic with the tenant write.
 */
@Injectable()
export class ExchangeTenantIdService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Backfill `exchangeTenantId` for every tenant that lacks one — the callable
   * equivalent of the `sync:tenant-exchange-id` script. Idempotent: only NULL
   * rows are touched, migrated ids are mirrored from `legacyTenantId` (never
   * invented), native ids are allocated sequentially, and the counter only ever
   * rises. Runs in a single transaction; touches only platform-level tables
   * (`tenants`, `platform_counters`) so no tenant RLS context is required.
   * @returns counts of what was seeded/assigned
   */
  async backfillAll(): Promise<ExchangeIdBackfillResult> {
    return this.prisma.$transaction(async (tx) => {
      const floor = await this.seedFloor(tx);

      const migratedMissing = await tx.tenant.findMany({
        where: {
          exchangeTenantId: null,
          legacyTenantId: { not: null },
          deletedAt: null,
        },
        select: { id: true, legacyTenantId: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      for (const t of migratedMissing) {
        if (t.legacyTenantId == null) continue;
        await tx.tenant.update({
          where: { id: t.id },
          data: { exchangeTenantId: t.legacyTenantId },
        });
        await this.bumpTo(tx, t.legacyTenantId);
      }

      const nativeMissing = await tx.tenant.findMany({
        where: {
          exchangeTenantId: null,
          legacyTenantId: null,
          deletedAt: null,
        },
        select: { id: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      for (const t of nativeMissing) {
        const id = await this.allocate(tx);
        await tx.tenant.update({
          where: { id: t.id },
          data: { exchangeTenantId: id },
        });
      }

      return {
        floor,
        migrated: migratedMissing.length,
        native: nativeMissing.length,
      };
    });
  }

  /**
   * Atomically allocate the next Exchange tenant id. The row lock taken by the
   * increment serialises concurrent tenant creates, so no two get the same id.
   * @param tx active Prisma transaction client
   * @returns the newly-allocated integer id
   */
  async allocate(tx: ExchangeIdTx): Promise<number> {
    const { value } = await tx.platformCounter.update({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY },
      data: { value: { increment: 1 } },
      select: { value: true },
    });
    return value;
  }

  /**
   * Raise the counter to at least `value` (never lowers it). Used when a migrated
   * tenant carries its own legacy id, to keep the high-water mark ahead of it.
   * @param tx active Prisma transaction client
   * @param value id the counter must be at or above
   */
  async bumpTo(tx: ExchangeIdTx, value: number): Promise<void> {
    await tx.platformCounter.updateMany({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY, value: { lt: value } },
      data: { value },
    });
  }

  /**
   * Resolve the `exchangeTenantId` for a tenant being created: migrated tenants
   * (a `legacyTenantId` is supplied) keep that exact id and bump the counter;
   * native tenants receive the next allocated id.
   * @param tx active Prisma transaction client
   * @param legacyTenantId source legacy id, or null/undefined for native tenants
   * @returns the integer to store as `exchangeTenantId`
   */
  async resolveForCreate(
    tx: ExchangeIdTx,
    legacyTenantId: number | null | undefined,
  ): Promise<number> {
    if (legacyTenantId != null) {
      await this.bumpTo(tx, legacyTenantId);
      return legacyTenantId;
    }
    return this.allocate(tx);
  }

  /**
   * Seed the counter to the current high-water mark:
   * `GREATEST(counter, MAX(legacyTenantId), MAX(exchangeTenantId))`. Idempotent —
   * only ever raises the counter. Run before backfilling native tenants.
   * @param tx active Prisma transaction client
   * @returns the floor the counter was set to
   */
  async seedFloor(tx: ExchangeIdTx): Promise<number> {
    const agg = await tx.tenant.aggregate({
      _max: { legacyTenantId: true, exchangeTenantId: true },
    });
    const current = await tx.platformCounter.findUnique({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY },
      select: { value: true },
    });
    const floor = Math.max(
      current?.value ?? 0,
      agg._max.legacyTenantId ?? 0,
      agg._max.exchangeTenantId ?? 0,
    );
    await this.bumpTo(tx, floor);
    return floor;
  }
}
