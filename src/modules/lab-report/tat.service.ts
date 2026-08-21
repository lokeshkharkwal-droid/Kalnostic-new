import { Injectable } from '@nestjs/common';
import {
  DayOfWeek,
  Prisma,
  ScheduleStatus,
  TatBand,
  TatUnit,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  classifyTat,
  evaluateTat,
  hhmmToMinutes,
  nextReportingSessionStart,
  resolveReportingCutoff,
  tatUnitToMinutes,
  toBranchLocalInstant,
  WorkingShift,
} from '../../common/utils';
import { ScheduleShift } from '../schedule/entities/schedule.entity';
import { LabReportListRow, WorklistTat } from './entities/lab-report.entity';
import {
  ActiveBranchRequiredException,
  LabReportNotFoundException,
} from './exceptions/lab-report.exceptions';

/** Why a report's Analytical TAT could (not) be computed. */
export type TatReason = 'OK' | 'NO_ACCEPTED_SAMPLE' | 'NO_ACTIVE_SCHEDULE';

/**
 * A report's Analytical-TAT breakdown (SRS §6.2): net working time between the
 * sample being **Accepted** (earliest linked sample's `acceptedAt`) and the
 * report being **Approved** (`approvedAt`, or "now" while still in-flight),
 * excluding breaks / closed hours / non-scheduled days, classified against the
 * test's configured Maximum TAT.
 */
export interface TatBreakdown {
  reportId: string;
  /** False when there's no accepted sample yet or no active branch schedule. */
  computable: boolean;
  reason: TatReason;
  /** Real UTC accept instant that starts the clock (earliest linked sample). */
  startAt: Date | null;
  /** Real UTC approve instant; null while the report is still in-flight. */
  endAt: Date | null;
  /** True once the report is approved (TAT frozen), false while live. */
  isFinal: boolean;
  /** Net working minutes accrued (rounded); null when not computable. */
  netMinutes: number | null;
  /** Configured Maximum TAT in minutes; null when unconfigured. */
  maxTatMinutes: number | null;
  /** The TAT band, or null when not computable / no max configured. */
  band: TatBand | null;
  /** Branch IANA timezone used for the calculation (null = app default). */
  timezone: string | null;
  /** The active schedule the operating calendar came from, if any. */
  scheduleId: string | null;
  /** The test's TAT configuration (Turnaround Time Details modal fields) —
   * null when the report is panel-backed (no equivalent config exists on
   * BranchLabPanel; see gather()'s test-only scheduleDays lookup). */
  config: TatConfigSnapshot | null;
}

/**
 * A test's TAT configuration, as configured on `BranchLabTest` (Turnaround
 * Time Details modal — Scheduled Days/Time, Processing Time Min/Max,
 * Reporting Time, Approval Duration Min/Max). Read-only display data; not
 * itself part of the TAT calculation inputs above (those are flattened
 * separately into shifts/scheduledDays/maxValue/maxUnit).
 */
export interface TatConfigSnapshot {
  tatMinValue: number | null;
  tatMinUnit: TatUnit | null;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  scheduleDays: DayOfWeek[];
  scheduleFrom: string | null;
  scheduleTo: string | null;
  procTimeMinValue: number | null;
  procTimeMinUnit: TatUnit | null;
  procTimeMaxValue: number | null;
  procTimeMaxUnit: TatUnit | null;
  reportingTimeFrom: string | null;
  reportingTimeTo: string | null;
  approvalDurationMinValue: number | null;
  approvalDurationMinUnit: TatUnit | null;
  approvalDurationMaxValue: number | null;
  approvalDurationMaxUnit: TatUnit | null;
}

/** The four `LabReport` columns frozen at approval (hybrid storage). */
export interface TatSnapshot {
  tatStartAt: Date | null;
  tatNetMinutes: number | null;
  tatMaxMinutes: number | null;
  tatBand: TatBand | null;
}

/** TAT analytics over approved reports in a period (SRS §9). */
export interface TatSummary {
  total: number;
  byBand: {
    WITHIN: number;
    WARNING: number;
    CRITICAL: number;
    BREACHED: number;
    /** Approved but not computable (no schedule/config at approval). */
    UNKNOWN: number;
  };
  avgNetMinutes: number | null;
  /** Fraction of computable reports that breached (0..1), null if none. */
  breachRate: number | null;
}

/** The raw inputs one TAT calculation needs, gathered in one place. */
interface TatInputs {
  reportId: string;
  approvedAt: Date | null;
  /** Earliest `acceptedAt` across the report's linked samples (TAT start). */
  startRaw: Date | null;
  shifts: WorkingShift[];
  scheduledDays: DayOfWeek[];
  maxValue: number | null;
  maxUnit: TatUnit | null;
  timezone: string | null;
  scheduleId: string | null;
  config: TatConfigSnapshot | null;
}

/**
 * Analytical-TAT computation for Technician Reporting (`LabReport`). A same-
 * module provider injected into `LabReportService` (CLAUDE.md rule #3 — never a
 * cross-module file import), plus the `GET /lab-reports/:id/tat` breakdown.
 *
 * Storage is hybrid: in-flight reports are computed live (end = "now"); at
 * approval, `LabReportService.approve` freezes {@link buildApprovalSnapshot}
 * onto the `LabReport.tat*` columns for fast, config-change-proof analytics.
 */
@Injectable()
export class TatService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute a report's TAT breakdown for display. Uses the stored `approvedAt`
   * as the end when approved, otherwise measures against "now".
   * @param reportId the lab report id
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT); required
   * @throws ActiveBranchRequiredException / LabReportNotFoundException
   */
  async computeForReport(
    reportId: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<TatBreakdown> {
    const activeBranchId = this.requireBranch(branchId);
    // NABL cron-managed reports are the source of truth in their own columns —
    // read them straight back rather than recomputing from acceptedAt.
    const nabl = await this.readNablColumns(reportId, tenantId, activeBranchId);
    if (nabl?.isNablTat) {
      return {
        reportId,
        computable: nabl.tatStartAt != null,
        reason: nabl.tatStartAt != null ? 'OK' : 'NO_ACCEPTED_SAMPLE',
        startAt: nabl.tatStartAt,
        endAt: nabl.tatEndAt ?? nabl.approvedAt,
        isFinal: nabl.approvedAt != null,
        netMinutes: nabl.tatNetMinutes,
        maxTatMinutes: nabl.tatMaxMinutes,
        band: nabl.tatBand,
        timezone: await this.loadTimezone(tenantId, activeBranchId),
        scheduleId: null,
        config: await this.loadConfigSnapshot(
          reportId,
          tenantId,
          activeBranchId,
        ),
      };
    }
    const inputs = await this.gather(reportId, tenantId, activeBranchId);
    const end = inputs.approvedAt ?? new Date();
    return this.evaluate(inputs, end, inputs.approvedAt != null);
  }

  /** The NABL stopwatch columns for a report (null if the report is missing). */
  private readNablColumns(
    reportId: string,
    tenantId: string,
    branchId: string,
  ) {
    return this.prisma.labReport.findFirst({
      where: { id: reportId, tenantId, branchId, deletedAt: null },
      select: {
        isNablTat: true,
        tatStartAt: true,
        tatEndAt: true,
        tatNetMinutes: true,
        tatMaxMinutes: true,
        tatBand: true,
        approvedAt: true,
      },
    });
  }

  /**
   * Build the frozen TAT snapshot for a report being approved. Called inside
   * `LabReportService.approve` before the status write so the four `tat*`
   * columns are persisted in the same update.
   * @param reportId the lab report id
   * @param tenantId tenant scope
   * @param branchId active branch (required)
   * @param approvedAt the approval instant being stamped (the TAT end)
   */
  async buildApprovalSnapshot(
    reportId: string,
    tenantId: string,
    branchId: string,
    approvedAt: Date,
  ): Promise<TatSnapshot> {
    const inputs = await this.gather(reportId, tenantId, branchId);
    const bd = this.evaluate(inputs, approvedAt, true);
    return {
      tatStartAt: bd.startAt,
      tatNetMinutes: bd.netMinutes,
      tatMaxMinutes: bd.maxTatMinutes,
      tatBand: bd.band,
    };
  }

  /**
   * Finalize a **NABL cron-managed** report's stopwatch at approval (the final
   * stop). Adds the last in-window sliver accrued since the previous cron tick
   * (clamped to the test's processing-window end so approving mid-window never
   * over-counts), stops the clock, and re-bands. `tatStartAt` is left exactly as
   * the cron set it (the first-start instant). Called by `LabReportService.approve`
   * only when `report.isNablTat === true`; OFF branches use {@link buildApprovalSnapshot}.
   * @param reportId the lab report id
   * @param tenantId tenant scope
   * @param branchId active branch (required)
   * @param approvedAt the approval instant being stamped (the final TAT stop)
   */
  async buildNablFinalize(
    reportId: string,
    tenantId: string,
    branchId: string,
    approvedAt: Date,
  ): Promise<{
    tatNetMinutes: number;
    tatMaxMinutes: number | null;
    tatBand: TatBand | null;
    tatEndAt: Date;
    tatIsRunning: boolean;
  }> {
    const report = await this.prisma.labReport.findFirst({
      where: { id: reportId, tenantId, branchId, deletedAt: null },
      include: {
        orderItem: { include: { branchLabTest: true, branchLabPanel: true } },
      },
    });
    if (!report) throw new LabReportNotFoundException(reportId);

    const test = report.orderItem?.branchLabTest ?? null;
    const panel = report.orderItem?.branchLabPanel ?? null;
    const maxMinutes = tatUnitToMinutes(
      test?.tatMaxValue ?? panel?.tatMaxValue ?? null,
      test?.tatMaxUnit ?? panel?.tatMaxUnit ?? null,
    );
    const timezone = await this.loadTimezone(tenantId, branchId);

    let net = report.tatNetMinutes ?? 0;
    if (report.tatIsRunning && report.tatLastTickAt) {
      const lastLocal = toBranchLocalInstant(report.tatLastTickAt, timezone);
      const lastMin = lastLocal.getUTCHours() * 60 + lastLocal.getUTCMinutes();
      const elapsed = Math.round(
        (approvedAt.getTime() - report.tatLastTickAt.getTime()) / 60_000,
      );
      const remaining = test?.processingTimeTo
        ? (((hhmmToMinutes(test.processingTimeTo) - lastMin) % 1440) + 1440) %
          1440
        : elapsed;
      net += Math.max(0, Math.min(elapsed, remaining));
    }

    const band = classifyTat(net, maxMinutes);
    return {
      tatNetMinutes: net,
      tatMaxMinutes: maxMinutes,
      tatBand: band ? TatBand[band] : null,
      tatEndAt: approvedAt,
      tatIsRunning: false,
    };
  }

  private requireBranch(branchId: string | null): string {
    if (!branchId) throw new ActiveBranchRequiredException();
    return branchId;
  }

  /** Load report + config + linked samples + active schedule + branch tz. */
  private async gather(
    reportId: string,
    tenantId: string,
    branchId: string,
  ): Promise<TatInputs> {
    const report = await this.prisma.labReport.findFirst({
      where: { id: reportId, tenantId, branchId, deletedAt: null },
      include: {
        orderItem: { include: { branchLabTest: true, branchLabPanel: true } },
      },
    });
    if (!report) throw new LabReportNotFoundException(reportId);

    // Earliest acceptedAt among the test's (non-deleted) linked samples = start.
    const links = await this.prisma.accessionSampleTest.findMany({
      where: { orderItemId: report.orderItemId, tenantId },
      include: { sample: { select: { acceptedAt: true, deletedAt: true } } },
    });
    const acceptedMs = links
      .map((l) => l.sample)
      .filter((s) => s.deletedAt === null && s.acceptedAt != null)
      .map((s) => (s.acceptedAt as Date).getTime());
    const startRaw = acceptedMs.length
      ? new Date(Math.min(...acceptedMs))
      : null;

    const { shifts, scheduleId } = await this.loadCalendar(tenantId, branchId);
    const timezone = await this.loadTimezone(tenantId, branchId);

    const test = report.orderItem?.branchLabTest ?? null;
    const panel = report.orderItem?.branchLabPanel ?? null;

    return {
      reportId,
      approvedAt: report.approvedAt,
      startRaw,
      shifts,
      scheduledDays: test?.scheduleDays ?? [],
      maxValue: test?.tatMaxValue ?? panel?.tatMaxValue ?? null,
      maxUnit: test?.tatMaxUnit ?? panel?.tatMaxUnit ?? null,
      timezone,
      scheduleId,
      config: this.toConfigSnapshot(test),
    };
  }

  /**
   * Resolve the branch's active operating calendar (SRS §4): the shifts (with
   * breaks) of the one ACTIVE schedule whose effective-date range covers today.
   * @returns the engine-shaped shifts plus the source schedule id (null if none)
   */
  private async loadCalendar(
    tenantId: string,
    branchId: string,
  ): Promise<{ shifts: WorkingShift[]; scheduleId: string | null }> {
    const now = new Date();
    const schedule = await this.prisma.schedule.findFirst({
      where: {
        tenantId,
        branchId,
        status: ScheduleStatus.ACTIVE,
        deletedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const rawShifts =
      (schedule?.shifts as unknown as ScheduleShift[] | null) ?? [];
    const shifts: WorkingShift[] = rawShifts.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      activeDays: s.activeDays,
      breaks:
        s.breakStartTime &&
        s.breakEndTime &&
        s.breakStartTime !== s.breakEndTime
          ? [{ startTime: s.breakStartTime, endTime: s.breakEndTime }]
          : [],
    }));
    return { shifts, scheduleId: schedule?.id ?? null };
  }

  /** The branch's IANA timezone (null = fall back to app default). */
  private async loadTimezone(
    tenantId: string,
    branchId: string,
  ): Promise<string | null> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId, deletedAt: null },
      select: { timezone: true },
    });
    return branch?.timezone ?? null;
  }

  /** Map a `BranchLabTest` row's TAT-config fields into a display snapshot
   * (Turnaround Time Details modal). Null input (panel-backed report, or
   * report not found) yields null — see {@link TatConfigSnapshot}'s doc. */
  private toConfigSnapshot(
    test: {
      tatMinValue: number | null;
      tatMinUnit: TatUnit | null;
      tatMaxValue: number | null;
      tatMaxUnit: TatUnit | null;
      scheduleDays: DayOfWeek[];
      scheduleFrom: string | null;
      scheduleTo: string | null;
      procTimeMinValue: number | null;
      procTimeMinUnit: TatUnit | null;
      procTimeMaxValue: number | null;
      procTimeMaxUnit: TatUnit | null;
      reportingTimeFrom: string | null;
      reportingTimeTo: string | null;
      approvalDurationMinValue: number | null;
      approvalDurationMinUnit: TatUnit | null;
      approvalDurationMaxValue: number | null;
      approvalDurationMaxUnit: TatUnit | null;
    } | null,
  ): TatConfigSnapshot | null {
    if (!test) return null;
    return {
      tatMinValue: test.tatMinValue,
      tatMinUnit: test.tatMinUnit,
      tatMaxValue: test.tatMaxValue,
      tatMaxUnit: test.tatMaxUnit,
      scheduleDays: test.scheduleDays,
      scheduleFrom: test.scheduleFrom,
      scheduleTo: test.scheduleTo,
      procTimeMinValue: test.procTimeMinValue,
      procTimeMinUnit: test.procTimeMinUnit,
      procTimeMaxValue: test.procTimeMaxValue,
      procTimeMaxUnit: test.procTimeMaxUnit,
      reportingTimeFrom: test.reportingTimeFrom,
      reportingTimeTo: test.reportingTimeTo,
      approvalDurationMinValue: test.approvalDurationMinValue,
      approvalDurationMinUnit: test.approvalDurationMinUnit,
      approvalDurationMaxValue: test.approvalDurationMaxValue,
      approvalDurationMaxUnit: test.approvalDurationMaxUnit,
    };
  }

  /** Load + map a report's test TAT config (NABL path — doesn't otherwise
   * fetch `orderItem.branchLabTest`, unlike {@link gather}). */
  private async loadConfigSnapshot(
    reportId: string,
    tenantId: string,
    branchId: string,
  ): Promise<TatConfigSnapshot | null> {
    const report = await this.prisma.labReport.findFirst({
      where: { id: reportId, tenantId, branchId, deletedAt: null },
      include: { orderItem: { include: { branchLabTest: true } } },
    });
    return this.toConfigSnapshot(report?.orderItem?.branchLabTest ?? null);
  }

  /**
   * Whether a report's result — being validated right now — has landed after
   * today's reporting cutoff (SRS §5.4/§5.5), and if so, when the next
   * Reporting session opens. Called by `LabReportService.validate()`; the
   * returned `deferredUntil` (if any) is stamped onto
   * `LabReport.reportingDeferredUntil` in the same update, and later checked
   * by `approve()`. Returns `{ isPastCutoff: false }` when the report's test
   * has no Reporting Time / Approval Duration configured — the gate is opt-in
   * per test, not a default restriction.
   * @param reportId the lab report id
   * @param tenantId tenant scope
   * @param branchId active branch (required)
   */
  async resolveReportingDeferral(
    reportId: string,
    tenantId: string,
    branchId: string,
  ): Promise<{ isPastCutoff: boolean; deferredUntil: Date | null }> {
    const report = await this.prisma.labReport.findFirst({
      where: { id: reportId, tenantId, branchId, deletedAt: null },
      include: {
        orderItem: { include: { branchLabTest: true } },
      },
    });
    if (!report) throw new LabReportNotFoundException(reportId);

    // Reporting window / Approval duration / Scheduled days are LabTest-only
    // concepts (no equivalent on BranchLabPanel — see LabPanel/BranchLabPanel,
    // which only carry Min/Max TAT) — a panel-backed report has nothing to
    // defer against, same as gather()'s test-only scheduleDays lookup above.
    const test = report.orderItem?.branchLabTest ?? null;
    const reportingTimeFrom = test?.reportingTimeFrom ?? null;
    const reportingTimeTo = test?.reportingTimeTo ?? null;
    const maxApprovalMinutes = tatUnitToMinutes(
      test?.approvalDurationMaxValue ?? null,
      test?.approvalDurationMaxUnit ?? null,
    );
    const scheduledDays = test?.scheduleDays ?? [];

    const timezone = await this.loadTimezone(tenantId, branchId);
    const now = new Date();
    const nowLocal = toBranchLocalInstant(now, timezone);

    const cutoff = resolveReportingCutoff(
      nowLocal,
      reportingTimeTo,
      maxApprovalMinutes,
    );
    if (!cutoff.configured || !cutoff.isPastCutoff || !reportingTimeFrom) {
      return { isPastCutoff: false, deferredUntil: null };
    }

    const nextLocal = nextReportingSessionStart(
      nowLocal,
      reportingTimeFrom,
      scheduledDays,
    );
    // nextReportingSessionStart works in the same "UTC fields = branch-local
    // clock" space as nowLocal; convert back to a real instant by re-applying
    // the branch's UTC offset, derived from this single `now` read (avoids a
    // second wall-clock call drifting the offset by the time between reads).
    const offsetMs = nowLocal.getTime() - now.getTime();
    const deferredUntil = new Date(nextLocal.getTime() - offsetMs);

    return { isPastCutoff: true, deferredUntil };
  }

  /** Turn gathered inputs + an end instant into a breakdown. */
  private evaluate(
    inputs: TatInputs,
    endRaw: Date,
    isFinal: boolean,
  ): TatBreakdown {
    const base = {
      reportId: inputs.reportId,
      startAt: inputs.startRaw,
      endAt: isFinal ? endRaw : null,
      isFinal,
      timezone: inputs.timezone,
      scheduleId: inputs.scheduleId,
      config: inputs.config,
    };

    if (!inputs.startRaw) {
      return {
        ...base,
        computable: false,
        reason: 'NO_ACCEPTED_SAMPLE',
        netMinutes: null,
        maxTatMinutes: null,
        band: null,
      };
    }
    if (inputs.shifts.length === 0) {
      return {
        ...base,
        computable: false,
        reason: 'NO_ACTIVE_SCHEDULE',
        netMinutes: null,
        maxTatMinutes: null,
        band: null,
      };
    }

    const start = toBranchLocalInstant(inputs.startRaw, inputs.timezone);
    const end = toBranchLocalInstant(endRaw, inputs.timezone);
    const result = evaluateTat(
      start,
      end,
      { shifts: inputs.shifts, scheduledDays: inputs.scheduledDays },
      inputs.maxValue,
      inputs.maxUnit,
    );

    return {
      ...base,
      computable: true,
      reason: 'OK',
      netMinutes: Math.round(result.netMinutes),
      maxTatMinutes: result.maxTatMinutes,
      band: result.band ? TatBand[result.band] : null,
    };
  }

  /**
   * Compute the TAT band for a page of worklist rows in a fixed number of
   * queries (independent of page size). Approved rows reuse their frozen
   * snapshot columns (no compute); in-flight rows are evaluated live against
   * "now" using one shared calendar + timezone and a single batched sample
   * lookup. All rows belong to one branch (the worklist is branch-scoped).
   * @param tenantId tenant scope
   * @param branchId the resolved branch the page is scoped to
   * @param rows the raw `LabReport` rows (with `orderItem` config included)
   * @returns a map of report id → its TAT figure
   */
  async computeBandsForReports(
    tenantId: string,
    branchId: string,
    rows: LabReportListRow[],
  ): Promise<Map<string, WorklistTat>> {
    const result = new Map<string, WorklistTat>();
    if (rows.length === 0) return result;

    const inflight: LabReportListRow[] = [];
    for (const r of rows) {
      if (r.approvedAt) {
        result.set(r.id, {
          band: r.tatBand,
          netMinutes: r.tatNetMinutes,
          maxTatMinutes: r.tatMaxMinutes,
          isFinal: true,
          computable: r.tatBand != null,
        });
      } else if (r.isNablTat) {
        // NABL cron-managed, still in-flight: read the accumulator columns the
        // cron maintains rather than recomputing from acceptedAt.
        result.set(r.id, {
          band: r.tatBand,
          netMinutes: r.tatNetMinutes,
          maxTatMinutes: r.tatMaxMinutes,
          isFinal: false,
          computable: r.tatStartAt != null,
        });
      } else {
        inflight.push(r);
      }
    }
    if (inflight.length === 0) return result;

    const { shifts } = await this.loadCalendar(tenantId, branchId);
    const timezone = await this.loadTimezone(tenantId, branchId);

    // Earliest acceptedAt per order item, batched across the whole page.
    const orderItemIds = [...new Set(inflight.map((r) => r.orderItemId))];
    const links = await this.prisma.accessionSampleTest.findMany({
      where: { orderItemId: { in: orderItemIds }, tenantId },
      include: { sample: { select: { acceptedAt: true, deletedAt: true } } },
    });
    const earliestByItem = new Map<string, number>();
    for (const l of links) {
      if (l.sample.deletedAt !== null || l.sample.acceptedAt == null) continue;
      const ms = l.sample.acceptedAt.getTime();
      const prev = earliestByItem.get(l.orderItemId);
      if (prev === undefined || ms < prev)
        earliestByItem.set(l.orderItemId, ms);
    }

    const nowLocalMs = new Date();
    for (const r of inflight) {
      const startMs = earliestByItem.get(r.orderItemId);
      if (startMs === undefined || shifts.length === 0) {
        result.set(r.id, {
          band: null,
          netMinutes: null,
          maxTatMinutes: null,
          isFinal: false,
          computable: false,
        });
        continue;
      }
      const test = r.orderItem?.branchLabTest ?? null;
      const panel = r.orderItem?.branchLabPanel ?? null;
      const evaluation = evaluateTat(
        toBranchLocalInstant(new Date(startMs), timezone),
        toBranchLocalInstant(nowLocalMs, timezone),
        { shifts, scheduledDays: test?.scheduleDays ?? [] },
        test?.tatMaxValue ?? panel?.tatMaxValue ?? null,
        test?.tatMaxUnit ?? panel?.tatMaxUnit ?? null,
      );
      result.set(r.id, {
        band: evaluation.band ? TatBand[evaluation.band] : null,
        netMinutes: Math.round(evaluation.netMinutes),
        maxTatMinutes: evaluation.maxTatMinutes,
        isFinal: false,
        computable: true,
      });
    }
    return result;
  }

  /**
   * TAT analytics over **approved** reports in a period (SRS §9), read straight
   * from the frozen snapshot columns (fast — no per-row recompute). Grouped by
   * band, with the average net working time and the breach rate among
   * computable reports.
   * @param tenantId tenant scope
   * @param branchId active branch (or the explicit `branchId` filter)
   * @param filters optional `approvedAt` date range + branch override
   */
  async summary(
    tenantId: string,
    branchId: string | null,
    filters: { dateFrom?: string; dateTo?: string; branchId?: string },
  ): Promise<TatSummary> {
    const resolvedBranch = this.requireBranch(filters.branchId ?? branchId);

    const approvedAt: Prisma.DateTimeNullableFilter = {};
    if (filters.dateFrom) approvedAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) approvedAt.lte = new Date(filters.dateTo);
    const where: Prisma.LabReportWhereInput = {
      tenantId,
      branchId: resolvedBranch,
      deletedAt: null,
      approvedAt:
        filters.dateFrom || filters.dateTo ? approvedAt : { not: null },
    };

    const grouped = await this.prisma.labReport.groupBy({
      by: ['tatBand'],
      where,
      _count: { _all: true },
    });
    const agg = await this.prisma.labReport.aggregate({
      where,
      _avg: { tatNetMinutes: true },
      _count: { _all: true },
    });

    const byBand = {
      WITHIN: 0,
      WARNING: 0,
      CRITICAL: 0,
      BREACHED: 0,
      UNKNOWN: 0,
    };
    let computable = 0;
    for (const g of grouped) {
      const count = g._count._all;
      if (g.tatBand === null) {
        byBand.UNKNOWN += count;
      } else {
        byBand[g.tatBand] += count;
        computable += count;
      }
    }

    return {
      total: agg._count._all,
      byBand,
      avgNetMinutes:
        agg._avg.tatNetMinutes != null
          ? Math.round(agg._avg.tatNetMinutes)
          : null,
      breachRate: computable > 0 ? byBand.BREACHED / computable : null,
    };
  }
}
