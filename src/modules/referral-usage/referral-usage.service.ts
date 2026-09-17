import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ACTIVE_SAMPLE_STATUSES,
  INACTIVE_ORDER_STATUSES,
  TERMINAL_LAB_REPORT_STATUS,
} from './constants/active-order.constant';

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
 * active-workflow order?". Injected into all four referral services (via
 * `ReferralUsageModule`) so the delete guard and the listing `hasActiveOrder`
 * flag share one definition of "active" (CLAUDE.md rule #3 — wired through DI,
 * never a direct service import).
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
          orderSamples: {
            some: { status: { in: [...ACTIVE_SAMPLE_STATUSES] } },
          },
        },
        {
          items: {
            some: {
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
}
