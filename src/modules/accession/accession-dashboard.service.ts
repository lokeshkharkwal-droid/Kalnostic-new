import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SampleSource,
  SampleStatus,
  TransferKind,
  TransferStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessionSettingsService } from './accession-settings.service';
import {
  TatStatus,
  TatThresholds,
  deriveTatStatus,
} from './constants/tat.constant';
import {
  AccessionDashboardSlice,
  AccessionStatCard,
  ReferralOrderBar,
} from './entities/accession-dashboard.entity';

/**
 * Accession dashboard's header date-range filter, applied only to the 4
 * `SampleTransfer`-based event cards (Internal/External Referral Orders,
 * Outsource Orders, Rejected Samples) — every other card here is a live
 * current-state snapshot with no historical meaning and always ignores this
 * (confirmed with the user). Omitted (no range picked) returns each of
 * those 4 cards' normal all-time total; when both bounds are set, counts
 * are scoped to transfers created within that range instead. Mirrors
 * `DashboardService`'s identically-named helper for business-admin/
 * branch-admin.
 */
function createdAtRange(
  dateFrom?: string,
  dateTo?: string,
): { gte: Date; lt: Date } | undefined {
  if (!dateFrom || !dateTo) return undefined;
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: start, lt: end };
}

/**
 * Builds the `branchId` clause for every dashboard aggregate's `where`.
 * `undefined`/omitted = no filter. A single string = exactly that branch
 * (normal single-branch users, or a Business Admin who picked one specific
 * branch). A string array = a Business Admin's "All Branches" aggregate,
 * scoped to only the branches they actually have Accession access to
 * (resolved by the controller's `resolveBranchScope` before reaching here —
 * never literally every tenant branch). Mirrors `DashboardService`'s
 * identically-named helper for Registration.
 */
function branchWhere(
  branchId?: string | string[],
):
  | { branchId: string }
  | { branchId: { in: string[] } }
  | Record<string, never> {
  if (!branchId) return {};
  if (Array.isArray(branchId)) return { branchId: { in: branchId } };
  return { branchId };
}

/** Fixed display order for the TAT Compliance donut, matching the screenshot. */
const TAT_LABELS: Record<TatStatus, string> = {
  WITHIN: 'Within TAT',
  WARNING: 'Warning',
  CRITICAL: 'Breach (Imminent)',
  BREACHED: 'Breached',
};
const TAT_DISPLAY_ORDER: TatStatus[] = [
  'WITHIN',
  'WARNING',
  'CRITICAL',
  'BREACHED',
];

/**
 * `SampleStatus` enum value → dashboard pill display label. Matches the
 * screenshot/`ORDER_STATUS_STYLES` labels exactly — note "Sent"/"Forward",
 * not the enum's own "SENT_INTERNAL"/"FORWARD_EXTERNAL".
 */
const STATUS_LABELS: Record<SampleStatus, string> = {
  NEW: 'New',
  COLLECTED: 'Collected',
  ACCEPTED: 'Accepted',
  ACQUIRED: 'Acquired',
  HALT: 'Halt',
  ERROR: 'Error',
  HOLD: 'Hold',
  REPEAT: 'Repeat',
  SENT_INTERNAL: 'Sent',
  FORWARD_EXTERNAL: 'Forward',
  STORED: 'Stored',
  DISCARDED: 'Discarded',
  RETURNED: 'Returned',
  CANCELLED: 'Canceled',
  OUTSOURCED: 'Outsourced',
};

/** Fixed display order — matches the screenshot's pill grid, not the enum's declaration order. */
const STATUS_DISPLAY_ORDER: SampleStatus[] = [
  SampleStatus.NEW,
  SampleStatus.COLLECTED,
  SampleStatus.ACCEPTED,
  SampleStatus.ACQUIRED,
  SampleStatus.HALT,
  SampleStatus.ERROR,
  SampleStatus.HOLD,
  SampleStatus.REPEAT,
  SampleStatus.SENT_INTERNAL,
  SampleStatus.FORWARD_EXTERNAL,
  SampleStatus.STORED,
  SampleStatus.DISCARDED,
  SampleStatus.RETURNED,
  SampleStatus.CANCELLED,
  SampleStatus.OUTSOURCED,
];

/**
 * Aggregate read-models for the Accession dashboard (`/accession/dashboard`).
 * Distinct from `OrderSampleService`'s `summary()` (which powers the
 * in-branch sample list's status tabs + TAT bar) — this service supports an
 * optional tenant-wide `branchId` (the dashboard's "All Branches" filter),
 * unlike every other Accession endpoint, which is always locked to the
 * caller's own active branch (confirmed with the user).
 */
@Injectable()
export class AccessionDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AccessionSettingsService,
  ) {}

  /**
   * Top-of-page stat cards: Total Samples, In-House, Internal Referral,
   * External Referral, Outsourced — each with a %-change vs. yesterday.
   *
   * A sample's order can independently carry a referral (internal/external)
   * AND a sample source (in-house/outsourced) — these are two unrelated
   * fields, not one. Per the user's explicit call: referral takes priority.
   * Each sample counts toward exactly one bucket, checked in this order:
   *   1. `Order.internalReferralId` set → Internal Referral
   *   2. `Order.externalReferralId` set → External Referral
   *   3. `OrderDiagnostics.sampleSource = SUPPLIED` → Outsourced
   *   4. else → In-House
   * Total Samples is the sum of all four (every sample falls in exactly one).
   * @param tenantId tenant scope
   * @param branchId branch scope; omitted ("All Branches") aggregates across the whole tenant
   */
  async getStatsSummary(
    tenantId: string,
    branchId?: string | string[],
  ): Promise<AccessionStatCard[]> {
    const { todayStart, yesterdayStart } = this.getUtcDayBounds();

    const [todayCounts, yesterdayCounts] = await Promise.all([
      this.countBuckets(tenantId, branchId, { gte: todayStart }),
      this.countBuckets(tenantId, branchId, {
        gte: yesterdayStart,
        lt: todayStart,
      }),
    ]);

    const pct = (today: number, yesterday: number): number =>
      yesterday > 0 ? ((today - yesterday) / yesterday) * 100 : 0;

    return [
      {
        label: 'Total Samples',
        value: todayCounts.total,
        changePct: pct(todayCounts.total, yesterdayCounts.total),
      },
      {
        label: 'In-House Orders',
        value: todayCounts.inHouse,
        changePct: pct(todayCounts.inHouse, yesterdayCounts.inHouse),
      },
      {
        label: 'Internal Referral',
        value: todayCounts.internalReferral,
        changePct: pct(
          todayCounts.internalReferral,
          yesterdayCounts.internalReferral,
        ),
      },
      {
        label: 'External Referral',
        value: todayCounts.externalReferral,
        changePct: pct(
          todayCounts.externalReferral,
          yesterdayCounts.externalReferral,
        ),
      },
      {
        label: 'Outsourced',
        value: todayCounts.outsourced,
        changePct: pct(todayCounts.outsourced, yesterdayCounts.outsourced),
      },
    ];
  }

  /**
   * In-house order status overview: a count per `SampleStatus`, all 15
   * statuses always present (zero-filled) so the pill grid's layout never
   * shifts. Every status currently open on an accession sample — unlike
   * {@link getStatsSummary}, this is a live snapshot (no date window), same
   * as `OrderSampleService.summary()`'s status tabs.
   * @param tenantId tenant scope
   * @param branchId branch scope; omitted ("All Branches") aggregates across the whole tenant
   */
  async getOrderStatusOverview(
    tenantId: string,
    branchId?: string | string[],
  ): Promise<AccessionDashboardSlice[]> {
    const grouped = await this.prisma.orderSample.groupBy({
      by: ['status'],
      where: {
        tenantId,
        ...branchWhere(branchId),
        deletedAt: null,
      },
      _count: { _all: true },
    });
    const countByStatus = new Map<SampleStatus, number>(
      grouped.map((g) => [g.status, g._count._all]),
    );
    return STATUS_DISPLAY_ORDER.map((status) => ({
      label: STATUS_LABELS[status],
      value: countByStatus.get(status) ?? 0,
    }));
  }

  /**
   * TAT compliance donut: a count per TAT band (Within TAT / Warning /
   * Breach (Imminent) / Breached), derived live from each sample's age vs
   * the branch's TAT thresholds — same `deriveTatStatus()` utility
   * `OrderSampleService.summary()` uses for the in-branch TAT bar.
   * Terminal samples (discarded/returned/cancelled) have no active TAT and
   * are excluded, same as that method.
   *
   * For "All Branches" (branchId omitted), thresholds fall back to the
   * tenant-level defaults (`AccessionSettingsService.resolve(tenantId,
   * null)`) rather than mixing each sample's own branch's thresholds — a
   * deliberate simplification, since TAT config is genuinely per-branch and
   * there's no single meaningful threshold to apply tenant-wide otherwise.
   * @param tenantId tenant scope
   * @param branchId branch scope; omitted ("All Branches") aggregates across the whole tenant using default thresholds
   */
  async getTatCompliance(
    tenantId: string,
    branchId?: string | string[],
  ): Promise<AccessionDashboardSlice[]> {
    // TAT thresholds are a per-branch setting; a multi-branch aggregate (an
    // array — Business Admin's "All Branches") has no single branch's
    // settings to use, so this falls back to tenant defaults exactly like
    // the existing "branchId omitted" case (intentional simplification,
    // not a bug — see the settings service's `resolve(tenantId, null)`).
    const singleBranchId = typeof branchId === 'string' ? branchId : null;
    const tat = await this.tatThresholds(tenantId, singleBranchId);
    const nowMs = Date.now();
    const samples = await this.prisma.orderSample.findMany({
      where: {
        tenantId,
        ...branchWhere(branchId),
        deletedAt: null,
      },
      select: { createdAt: true, status: true },
    });

    const byTat: Record<TatStatus, number> = {
      WITHIN: 0,
      WARNING: 0,
      CRITICAL: 0,
      BREACHED: 0,
    };
    for (const s of samples) {
      const band = deriveTatStatus(s.createdAt, s.status, tat, nowMs);
      if (band) byTat[band] += 1;
    }

    return TAT_DISPLAY_ORDER.map((band) => ({
      label: TAT_LABELS[band],
      value: byTat[band],
    }));
  }

  /**
   * Critical alerts: TAT Breached, Samples On Hold, Repeat Samples, Rejected
   * Samples.
   *
   * - TAT Breached: samples in the BREACHED band (same `deriveTatStatus()`
   *   computation as {@link getTatCompliance}).
   * - Samples On Hold / Repeat Samples: `OrderSample.status` = HOLD /
   *   REPEAT (live counts, no date window — matches {@link getOrderStatusOverview}).
   * - Rejected Samples: `SampleTransfer.transferStatus = REJECTED`, scoped
   *   by `destinationBranchId` (the receiving branch — the one that made the
   *   rejection decision; see PDF §B.2/B.5 "Rejected — Receiving branch
   *   rejects the sample entirely"), not `branchId`/`originBranchId`. This is
   *   a REAL, spec-defined status (Part B Internal/External Referral flow —
   *   confirmed against ACCESSION.docx.pdf and the fully-implemented
   *   `SampleTransferService.reject()`), not a stretch mapping — verified
   *   with the user before building this.
   * @param tenantId tenant scope
   * @param branchId branch scope; omitted ("All Branches") aggregates across the whole tenant
   * @param dateFrom/dateTo header date-range filter — applies ONLY to Rejected Samples (a `SampleTransfer` event count); TAT Breached/On Hold/Repeat are live snapshots and always ignore this
   */
  async getCriticalAlerts(
    tenantId: string,
    branchId?: string | string[],
    dateFrom?: string,
    dateTo?: string,
  ): Promise<AccessionDashboardSlice[]> {
    // See getTatCompliance's comment — a multi-branch aggregate falls back
    // to tenant-default TAT thresholds, same as the "omitted" case.
    const singleBranchId = typeof branchId === 'string' ? branchId : null;
    const tat = await this.tatThresholds(tenantId, singleBranchId);
    const nowMs = Date.now();
    const createdAt = createdAtRange(dateFrom, dateTo);
    const destinationBranchWhere = !branchId
      ? {}
      : Array.isArray(branchId)
        ? { destinationBranchId: { in: branchId } }
        : { destinationBranchId: branchId };

    const [samples, rejectedCount] = await Promise.all([
      this.prisma.orderSample.findMany({
        where: {
          tenantId,
          ...branchWhere(branchId),
          deletedAt: null,
        },
        select: { createdAt: true, status: true },
      }),
      this.prisma.sampleTransfer.count({
        where: {
          tenantId,
          ...destinationBranchWhere,
          deletedAt: null,
          transferStatus: TransferStatus.REJECTED,
          ...(createdAt && { createdAt }),
        },
      }),
    ]);

    let tatBreachedCount = 0;
    let onHoldCount = 0;
    let repeatCount = 0;
    for (const s of samples) {
      if (deriveTatStatus(s.createdAt, s.status, tat, nowMs) === 'BREACHED') {
        tatBreachedCount += 1;
      }
      if (s.status === SampleStatus.HOLD) onHoldCount += 1;
      if (s.status === SampleStatus.REPEAT) repeatCount += 1;
    }

    return [
      { label: 'TAT Breached', value: tatBreachedCount },
      { label: 'Samples On Hold', value: onHoldCount },
      { label: 'Repeat Samples', value: repeatCount },
      { label: 'Rejected Samples', value: rejectedCount },
    ];
  }

  /**
   * Internal Referral Orders — Sent (to internal centers) vs. Received
   * (from internal centers), one bar per center (a real `Branch`).
   *
   * "Sent": `SampleTransfer` rows with `kind=INTERNAL` and
   * `originBranchId` = this branch (or, for "All Branches", any branch in
   * the tenant), grouped by `destinationBranchId`.
   * "Received": same rows, but scoped/grouped the other way around —
   * `destinationBranchId` = this branch, grouped by `originBranchId`.
   * For "All Branches" (branchId omitted), both sides aggregate across
   * every branch in the tenant (every INTERNAL transfer, grouped by the
   * *other* branch on each side).
   * @param tenantId tenant scope
   * @param branchId branch scope; omitted ("All Branches") aggregates across the whole tenant
   * @param dateFrom/dateTo header date-range filter; omitted returns the all-time total, set scopes to transfers created in that range
   */
  async getInternalReferralOrders(
    tenantId: string,
    branchId?: string | string[],
    dateFrom?: string,
    dateTo?: string,
  ): Promise<{ sent: ReferralOrderBar[]; received: ReferralOrderBar[] }> {
    const createdAt = createdAtRange(dateFrom, dateTo);
    const originWhere = !branchId
      ? {}
      : Array.isArray(branchId)
        ? { originBranchId: { in: branchId } }
        : { originBranchId: branchId };
    const destinationWhere = !branchId
      ? {}
      : Array.isArray(branchId)
        ? { destinationBranchId: { in: branchId } }
        : { destinationBranchId: branchId };
    const [sentGrouped, receivedGrouped] = await Promise.all([
      this.prisma.sampleTransfer.groupBy({
        by: ['destinationBranchId'],
        where: {
          tenantId,
          deletedAt: null,
          kind: TransferKind.INTERNAL,
          ...originWhere,
          destinationBranchId: { not: null },
          ...(createdAt && { createdAt }),
        },
        _count: { _all: true },
      }),
      this.prisma.sampleTransfer.groupBy({
        by: ['originBranchId'],
        where: {
          tenantId,
          deletedAt: null,
          kind: TransferKind.INTERNAL,
          ...destinationWhere,
          originBranchId: { not: null },
          ...(createdAt && { createdAt }),
        },
        _count: { _all: true },
      }),
    ]);

    const otherBranchIds = [
      ...new Set([
        ...sentGrouped.map((g) => g.destinationBranchId),
        ...receivedGrouped.map((g) => g.originBranchId),
      ]),
    ].filter((id): id is string => Boolean(id));
    const branchNameById = await this.resolveBranchNames(
      tenantId,
      otherBranchIds,
    );

    return {
      sent: sentGrouped.map((g) => ({
        center: branchNameById.get(g.destinationBranchId!) ?? 'Unknown Branch',
        count: g._count._all,
      })),
      received: receivedGrouped.map((g) => ({
        center: branchNameById.get(g.originBranchId!) ?? 'Unknown Branch',
        count: g._count._all,
      })),
    };
  }

  /**
   * External Referral Orders — Sent (to external partner labs) only.
   * "Received" (an external/cross-tenant partner lab forwarding a sample TO
   * us) has no backing today — `SampleTransferService`'s own doc comment
   * confirms cross-tenant receiving was never built ("Phase 3 open"); only
   * the sending side exists as real rows. The frontend keeps "Received" on
   * mock data (confirmed with the user) until that's built.
   *
   * "Sent": `SampleTransfer` rows with `kind=EXTERNAL` and `originBranchId`
   * = this branch (or every branch, for "All Branches"), grouped by
   * `externalPartnerName` (a free-text partner lab name — there's no real
   * `Branch` row for an external partner, unlike Internal Referral).
   * @param tenantId tenant scope
   * @param branchId branch scope; omitted ("All Branches") aggregates across the whole tenant
   * @param dateFrom/dateTo header date-range filter; omitted returns the all-time total, set scopes to transfers created in that range
   */
  async getExternalReferralOrdersSent(
    tenantId: string,
    branchId?: string | string[],
    dateFrom?: string,
    dateTo?: string,
  ): Promise<ReferralOrderBar[]> {
    const createdAt = createdAtRange(dateFrom, dateTo);
    const originWhere = !branchId
      ? {}
      : Array.isArray(branchId)
        ? { originBranchId: { in: branchId } }
        : { originBranchId: branchId };
    const grouped = await this.prisma.sampleTransfer.groupBy({
      by: ['externalPartnerName'],
      where: {
        tenantId,
        deletedAt: null,
        kind: TransferKind.EXTERNAL,
        ...originWhere,
        externalPartnerName: { not: null },
        ...(createdAt && { createdAt }),
      },
      _count: { _all: true },
    });
    return grouped.map((g) => ({
      center: g.externalPartnerName!,
      count: g._count._all,
    }));
  }

  /**
   * Outsource Orders — a donut of samples sent to third-party outsource
   * centers, grouped by center. `SampleTransfer` rows with `kind=OUTSOURCE`
   * and `originBranchId` = this branch (or every branch, for "All
   * Branches"), grouped by `outsourceCenterId` (resolved to
   * `OutsourceCenter.name` — a real third-party lab registered in this
   * tenant, unlike External Referral's free-text partner name).
   * @param tenantId tenant scope
   * @param branchId branch scope; omitted ("All Branches") aggregates across the whole tenant
   * @param dateFrom/dateTo header date-range filter; omitted returns the all-time total, set scopes to transfers created in that range
   */
  async getOutsourceOrders(
    tenantId: string,
    branchId?: string | string[],
    dateFrom?: string,
    dateTo?: string,
  ): Promise<AccessionDashboardSlice[]> {
    const createdAt = createdAtRange(dateFrom, dateTo);
    const originWhere = !branchId
      ? {}
      : Array.isArray(branchId)
        ? { originBranchId: { in: branchId } }
        : { originBranchId: branchId };
    const grouped = await this.prisma.sampleTransfer.groupBy({
      by: ['outsourceCenterId'],
      where: {
        tenantId,
        deletedAt: null,
        kind: TransferKind.OUTSOURCE,
        ...originWhere,
        outsourceCenterId: { not: null },
        ...(createdAt && { createdAt }),
      },
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];

    const centerIds = grouped
      .map((g) => g.outsourceCenterId)
      .filter((id): id is string => Boolean(id));
    const centers = await this.prisma.outsourceCenter.findMany({
      where: { id: { in: centerIds }, tenantId },
      select: { id: true, name: true },
    });
    const nameById = new Map(centers.map((c) => [c.id, c.name]));

    return grouped.map((g) => ({
      label: nameById.get(g.outsourceCenterId!) ?? 'Unknown Center',
      value: g._count._all,
    }));
  }

  /** Resolve `Branch.name` for a set of ids, tenant-scoped. */
  private async resolveBranchNames(
    tenantId: string,
    branchIds: string[],
  ): Promise<Map<string, string>> {
    if (branchIds.length === 0) return new Map();
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, tenantId },
      select: { id: true, name: true },
    });
    return new Map(branches.map((b) => [b.id, b.name]));
  }

  /**
   * The branch's (or tenant-default, when `branchId` is null) TAT
   * thresholds in minutes. Mirrors `OrderSampleService`'s private
   * `tatThresholds()` exactly — duplicated rather than exposed, since it's
   * a small pure computation over `AccessionSettingsService.resolve()`.
   */
  private async tatThresholds(
    tenantId: string,
    branchId: string | null,
  ): Promise<TatThresholds> {
    const settings = await this.settings.resolve(tenantId, branchId);
    const max = settings.Accession_MaximumTimeToAcceptSampleMinutes;
    return {
      warningMinutes: Math.max(
        0,
        max - settings.Accession_WarningThresholdMinutes,
      ),
      criticalMinutes: Math.max(
        0,
        max - settings.Accession_CriticalThresholdMinutes,
      ),
      breachedMinutes: max,
    };
  }

  /**
   * Categorize every accession sample created in `createdAtRange` into the
   * 5 stat buckets (see {@link getStatsSummary} for the priority rule).
   */
  private async countBuckets(
    tenantId: string,
    branchId: string | string[] | undefined,
    createdAtRange: Prisma.DateTimeFilter,
  ): Promise<{
    total: number;
    inHouse: number;
    internalReferral: number;
    externalReferral: number;
    outsourced: number;
  }> {
    const samples = await this.prisma.orderSample.findMany({
      where: {
        tenantId,
        ...branchWhere(branchId),
        deletedAt: null,
        createdAt: createdAtRange,
      },
      select: {
        order: {
          select: {
            internalReferralId: true,
            externalReferralId: true,
            diagnostics: { select: { sampleSource: true } },
          },
        },
      },
    });

    let inHouse = 0;
    let internalReferral = 0;
    let externalReferral = 0;
    let outsourced = 0;
    for (const s of samples) {
      if (s.order.internalReferralId) {
        internalReferral += 1;
      } else if (s.order.externalReferralId) {
        externalReferral += 1;
      } else if (s.order.diagnostics?.sampleSource === SampleSource.SUPPLIED) {
        outsourced += 1;
      } else {
        inHouse += 1;
      }
    }
    return {
      total: samples.length,
      inHouse,
      internalReferral,
      externalReferral,
      outsourced,
    };
  }

  /**
   * UTC-midnight boundaries for "today" and "yesterday" — `OrderSample.
   * createdAt` is a real timestamp, so any day-boundary comparison must use a
   * fixed UTC reference (same convention as `DashboardService.
   * getUtcTodayBounds`), not server-local midnight.
   */
  private getUtcDayBounds(): { todayStart: Date; yesterdayStart: Date } {
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
    return { todayStart, yesterdayStart };
  }
}
