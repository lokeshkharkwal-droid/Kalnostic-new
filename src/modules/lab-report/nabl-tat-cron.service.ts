import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  LabReportStatus,
  Prisma,
  SampleStatus,
  ScheduleStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isBranchOpenAt,
  toBranchLocalInstant,
  WorkingShift,
} from '../../common/utils';
import { ScheduleShift } from '../schedule/entities/schedule.entity';
import {
  NablReportState,
  NablWindowConfig,
  stepNablStopwatch,
} from './nabl-tat-stopwatch.util';

/** A report to evaluate this tick, paired with its window config + branch ctx. */
interface Candidate {
  reportId: string;
  report: NablReportState;
  cfg: NablWindowConfig;
  branchOpen: boolean;
  timezone: string | null;
}

/**
 * NABL-compliant TAT clock. For branches whose `BranchSetting.isNablTatEnabled`
 * is true, TAT is **not** driven by accept→approve; instead this 1-minute cron
 * runs a per-report stopwatch that only accrues inside each test's daily
 * processing window (`[processingTimeFrom, processingTimeTo]` on `scheduleDays`),
 * pausing at the window edge and resuming the next scheduled day. The final stop
 * is still the approve API (`LabReportService.approve`), which finalizes the
 * accumulated value. Branches with the flag OFF are never touched here — their
 * TAT keeps the legacy accept/approve flow byte-for-byte.
 *
 * The per-report transitions live in the pure {@link stepNablStopwatch} util
 * (unit-tested); this service only gathers inputs and persists the patches.
 *
 * Cross-tenant by design (the spec: samples are not tenant/branch scoped): it
 * iterates every tenant and runs each tenant's work under `withTenant` so RLS
 * still isolates the per-tenant queries (mirrors `AuditService.purgeExpired`).
 */
@Injectable()
export class NablTatCronService {
  private readonly logger = new Logger(NablTatCronService.name);
  /** Guards against a slow tick overlapping the next (>60s run). */
  private isTicking = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every minute: for each tenant with NABL-enabled branches, advance the
   * stopwatch of every in-flight lab report whose sample is ACCEPTED. Errors in
   * one tenant are logged and swallowed so they don't stall the others.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.isTicking) {
      this.logger.warn('Previous NABL TAT tick still running; skipping.');
      return;
    }
    this.isTicking = true;
    const now = new Date();
    try {
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
      });
      for (const { id: tenantId } of tenants) {
        try {
          await this.processTenant(tenantId, now);
        } catch (err) {
          this.logger.error(
            `NABL TAT tick failed for tenant ${tenantId}`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    } finally {
      this.isTicking = false;
    }
  }

  /** Advance every eligible report for one tenant, inside its RLS context. */
  private async processTenant(tenantId: string, now: Date): Promise<void> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      const settings = await tx.branchSetting.findMany({
        where: { isNablTatEnabled: true, deletedAt: null },
        select: { branchId: true },
      });
      if (settings.length === 0) return; // no NABL branches → nothing to do
      const branchIds = settings.map((s) => s.branchId);

      const branches = await tx.branch.findMany({
        where: { id: { in: branchIds }, deletedAt: null },
      });
      const branchById = new Map(branches.map((b) => [b.id, b]));
      const scheduleByBranch = await this.loadActiveSchedules(
        tx,
        branchIds,
        now,
      );

      // Branch-open + branch-local "now" are per-branch; compute once each.
      const openByBranch = new Map<string, boolean>();
      for (const b of branches) {
        const nowLocal = toBranchLocalInstant(now, b.timezone);
        openByBranch.set(
          b.id,
          isBranchOpenAt(nowLocal, {
            shifts: scheduleByBranch.get(b.id) ?? [],
            operationalDays: b.operationalDays,
            openingTime: b.openingTime,
            closingTime: b.closingTime,
          }),
        );
      }

      const samples = await tx.accessionSample.findMany({
        where: {
          status: SampleStatus.ACCEPTED,
          deletedAt: null,
          branchId: { in: branchIds },
        },
        include: {
          tests: {
            where: { deletedAt: null },
            include: {
              orderItem: {
                include: { branchLabTest: true, labReport: true },
              },
            },
          },
        },
      });

      // One stopwatch per report: dedupe (a report's order item can be linked
      // to more than one accepted sample) so we never double-count in a tick.
      const candidates = new Map<string, Candidate>();
      for (const sample of samples) {
        const branch = sample.branchId
          ? branchById.get(sample.branchId)
          : undefined;
        if (!branch) continue;
        for (const t of sample.tests) {
          const report = t.orderItem?.labReport;
          const cfg = t.orderItem?.branchLabTest;
          if (!report || !cfg) continue;
          if (report.status === LabReportStatus.APPROVED) continue;
          if (!cfg.processingTimeFrom || !cfg.processingTimeTo) continue;
          if (candidates.has(report.id)) continue;
          candidates.set(report.id, {
            reportId: report.id,
            report: {
              isNablTat: report.isNablTat,
              tatStartAt: report.tatStartAt,
              tatIsRunning: report.tatIsRunning,
              tatLastTickAt: report.tatLastTickAt,
              tatNetMinutes: report.tatNetMinutes,
            },
            cfg: {
              processingTimeFrom: cfg.processingTimeFrom,
              processingTimeTo: cfg.processingTimeTo,
              scheduleDays: cfg.scheduleDays,
              tatMaxValue: cfg.tatMaxValue,
              tatMaxUnit: cfg.tatMaxUnit,
            },
            branchOpen: openByBranch.get(branch.id) ?? false,
            timezone: branch.timezone,
          });
        }
      }

      for (const candidate of candidates.values()) {
        const patch = stepNablStopwatch(
          candidate.report,
          candidate.cfg,
          candidate.branchOpen,
          candidate.timezone,
          now,
        );
        if (patch) {
          await tx.labReport.update({
            where: { id: candidate.reportId },
            data: patch,
          });
        }
      }
    });
  }

  /**
   * Resolve, per branch, the shifts of the one ACTIVE schedule whose
   * effective-date range covers `now` (latest effectiveFrom wins). Mirrors
   * `TatService.loadCalendar`, batched across all NABL branches.
   */
  private async loadActiveSchedules(
    tx: Prisma.TransactionClient,
    branchIds: string[],
    now: Date,
  ): Promise<Map<string, WorkingShift[]>> {
    const rows = await tx.schedule.findMany({
      where: {
        branchId: { in: branchIds },
        status: ScheduleStatus.ACTIVE,
        deletedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const byBranch = new Map<string, WorkingShift[]>();
    for (const row of rows) {
      if (byBranch.has(row.branchId)) continue; // keep the latest-effective one
      const raw = (row.shifts as unknown as ScheduleShift[] | null) ?? [];
      byBranch.set(
        row.branchId,
        raw.map((s) => ({
          startTime: s.startTime,
          endTime: s.endTime,
          activeDays: s.activeDays,
          breaks:
            s.breakStartTime &&
            s.breakEndTime &&
            s.breakStartTime !== s.breakEndTime
              ? [{ startTime: s.breakStartTime, endTime: s.breakEndTime }]
              : [],
        })),
      );
    }
    return byBranch;
  }
}
