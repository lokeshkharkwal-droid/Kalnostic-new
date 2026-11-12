import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ACTIVE_SAMPLE_STATUSES,
  INACTIVE_ORDER_STATUSES,
  TERMINAL_LAB_REPORT_STATUS,
} from './constants/active-order.constant';
import { LAST_ORDER_EXCLUDED_STATUSES } from './constants/last-order.constant';
import { SAMPLE_NOT_ITEM_REMOVED } from '../accession/utils/item-removed.util';

/**
 * The four `Order` foreign-key columns that point at a referral entity. Kept as
 * a strict string-literal union so every call site is compile-checked (no `any`).
 */
export type ReferralFkField =
  | 'referralPanelId'
  | 'referredByDoctorId'
  | 'internalReferralId'
  | 'externalReferralId';

/**
 * Shared, read-only helper that answers "is this referral still used by an
 * active-workflow order?" and "when was an order last created with it?".
 * Injected into all four referral services (via `ReferralUsageModule`) so the
 * delete guard and the listing `hasActiveOrder` flag share one definition of
 * "active", and the listing `lastOrderCreatedAt` column shares one definition
 * of "an order" (CLAUDE.md rule #3 — wired through DI, never a direct service
 * import).
 *
 * Both methods are reads and therefore run under the request's RLS context set
 * by the global tenant interceptor — they must NOT be wrapped in
 * `prisma.withTenant` (that opens a write transaction). They also pass an
 * explicit `tenantId` filter for defence in depth (CLAUDE.md §4.3).
 */
@Injectable()
export class ReferralUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The shared "actively-using-a-referral" `Order` where-fragment: a
   * non-cancelled, non-deleted order that is still mid-workflow — it has a sample
   * in an in-flight accessioning state OR a lab report not yet published. Once
   * every report is published (samples resting at ACCEPTED/ACQUIRED/STORED), the
   * order is complete and neither branch matches, so it no longer blocks deletion.
   */
  private activeOrderWhere(): Prisma.OrderWhereInput {
    return {
      deletedAt: null,
      status: { notIn: [...INACTIVE_ORDER_STATUSES] },
      OR: [
        {
          // A sample whose test was removed from the order is kept (frozen) but is
          // no longer active work: skip a sample whose every live test link belongs
          // to a removed item. (A sample with no live link at all still counts, as
          // before.)
          orderSamples: {
            some: {
              status: { in: [...ACTIVE_SAMPLE_STATUSES] },
              ...SAMPLE_NOT_ITEM_REMOVED,
            },
          },
        },
        {
          items: {
            some: {
              // A removed test's kept (frozen) report is not active work either.
              deletedAt: null,
              labReports: {
                some: { status: { not: TERMINAL_LAB_REPORT_STATUS } },
              },
            },
          },
        },
      ],
    };
  }

  /**
   * Does this ONE referral have any active-workflow order? Used inside a
   * referral service's `remove()` to block deletion.
   *
   * @param tenantId caller's tenant (RLS + defence-in-depth filter)
   * @param field which `Order` referral FK column to match on
   * @param referralId the referral row id being deleted
   * @returns `true` when at least one active-workflow order references it
   */
  async hasActiveOrder(
    tenantId: string,
    field: ReferralFkField,
    referralId: string,
  ): Promise<boolean> {
    const count = await this.prisma.order.count({
      where: { tenantId, [field]: referralId, ...this.activeOrderWhere() },
      take: 1,
    });
    return count > 0;
  }

  /**
   * For a PAGE of referral ids, which ones have >= 1 active-workflow order?
   * One query per page (`findMany` + `distinct` on the FK) so listing endpoints
   * can flag `hasActiveOrder` per row without an N+1.
   *
   * @param tenantId caller's tenant (RLS + defence-in-depth filter)
   * @param field which `Order` referral FK column to match on
   * @param referralIds the page's referral ids
   * @returns the subset of ids that are actively used
   */
  async findActiveReferralIds(
    tenantId: string,
    field: ReferralFkField,
    referralIds: string[],
  ): Promise<Set<string>> {
    if (referralIds.length === 0) return new Set();
    const rows = await this.prisma.order.findMany({
      where: {
        tenantId,
        [field]: { in: referralIds },
        ...this.activeOrderWhere(),
      },
      distinct: [field],
      select: { [field]: true },
    });
    const active = new Set<string>();
    for (const row of rows) {
      const id = (row as Record<string, unknown>)[field];
      if (typeof id === 'string') active.add(id);
    }
    return active;
  }

  /**
   * For a PAGE of referral ids, when was the most recent order created with each
   * one? One `groupBy` per page (SQL `GROUP BY <fk>` + `MAX(created_at)`), so the
   * listing endpoints can show "Last Order Created Date and Time" per row without
   * an N+1. Computed live on every request, so editing an order's referral,
   * cancelling, or deleting it is reflected immediately (nothing is cached or
   * denormalised).
   *
   * Counts every non-deleted order except drafts and quotations
   * ({@link LAST_ORDER_EXCLUDED_STATUSES}), and uses the record's `createdAt`
   * (when it was actually created), not the user-entered `orderDate`, so a
   * back-dated order does not show a misleading time.
   *
   * @param tenantId caller's tenant (RLS + defence-in-depth filter)
   * @param field which `Order` referral FK column to match on
   * @param referralIds the page's referral ids
   * @returns referral id → latest order `createdAt`; ids with no counted order
   *   are absent from the map
   */
  async findLastOrderCreatedAt(
    tenantId: string,
    field: ReferralFkField,
    referralIds: string[],
  ): Promise<Map<string, Date>> {
    const latest = new Map<string, Date>();
    if (referralIds.length === 0) return latest;
    const rows = await this.prisma.order.groupBy({
      by: [field],
      where: {
        tenantId,
        [field]: { in: referralIds },
        deletedAt: null,
        status: { notIn: [...LAST_ORDER_EXCLUDED_STATUSES] },
      },
      _max: { createdAt: true },
    });
    for (const row of rows) {
      const id = (row as Record<string, unknown>)[field];
      const createdAt = row._max?.createdAt;
      if (typeof id === 'string' && createdAt) latest.set(id, createdAt);
    }
    return latest;
  }
}
