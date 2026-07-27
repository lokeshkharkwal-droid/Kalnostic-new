import { DayOfWeek, Prisma, TatBand, TatUnit } from '@prisma/client';
import {
  classifyTat,
  hhmmToMinutes,
  tatUnitToMinutes,
  toBranchLocalInstant,
} from '../../common/utils';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 24 * 60;

/** `getUTCDay()` (0=Sun..6=Sat) → Prisma `DayOfWeek`. */
const WEEKDAY_BY_UTC_DAY: readonly DayOfWeek[] = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

/**
 * The test's daily processing window (branch-local `HH:mm`) + max-TAT config the
 * stopwatch reads. `processingTimeFrom`/`To` are non-null (the cron pre-filters
 * reports whose test has no window configured).
 */
export interface NablWindowConfig {
  processingTimeFrom: string;
  processingTimeTo: string;
  scheduleDays: DayOfWeek[];
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
}

/** The mutable NABL stopwatch state read from a `LabReport`. */
export interface NablReportState {
  isNablTat: boolean;
  tatStartAt: Date | null;
  tatIsRunning: boolean;
  tatLastTickAt: Date | null;
  tatNetMinutes: number | null;
}

/**
 * The NABL stopwatch state machine for one report. Pure (no I/O) so the
 * transitions are exhaustively unit-testable. Returns the `LabReport` update
 * patch to apply this tick, or `null` when nothing changes.
 *
 * Transitions (all clock maths in branch-local time, `timezone`):
 *  - **START** — not started, branch open, inside the window on a scheduled day →
 *    begin the clock & mark the report NABL-managed.
 *  - **ACCUMULATE** — running, branch open, still inside the window → add the
 *    elapsed minutes since the last tick (clamped to the window end so we never
 *    over-count). When the branch is closed mid-window, only the tick clock
 *    advances (spec Step 1: closed time isn't counted).
 *  - **PAUSE** — running, past the window end → add the final sliver & pause
 *    (independent of branch-open, so a report never hangs "running").
 *  - **RESUME** — started, paused, branch open, back inside the window → resume
 *    (no minutes added; just restart the tick clock).
 *
 * @param report the report's current stopwatch columns
 * @param cfg the test's processing window + max-TAT config
 * @param branchOpen whether the branch is operational at `now` (spec Step 1)
 * @param timezone branch IANA timezone (null = app default / DB time is local)
 * @param now the current instant (real UTC)
 */
export function stepNablStopwatch(
  report: NablReportState,
  cfg: NablWindowConfig,
  branchOpen: boolean,
  timezone: string | null,
  now: Date,
): Prisma.LabReportUpdateInput | null {
  const nowLocal = toBranchLocalInstant(now, timezone);
  const nowMin = localMinuteOfDay(nowLocal);
  const todayDow = WEEKDAY_BY_UTC_DAY[nowLocal.getUTCDay()];

  const fromMin = hhmmToMinutes(cfg.processingTimeFrom);
  const toMin = hhmmToMinutes(cfg.processingTimeTo);
  const scheduledToday =
    cfg.scheduleDays.length === 0 ||
    (todayDow != null && cfg.scheduleDays.includes(todayDow));
  const inWindow = scheduledToday && isInWindow(nowMin, fromMin, toMin);
  const maxMinutes = tatUnitToMinutes(cfg.tatMaxValue, cfg.tatMaxUnit);

  // START — first time the window is entered on a scheduled, open day.
  if (!report.tatStartAt) {
    if (branchOpen && inWindow) {
      return {
        isNablTat: true,
        tatStartAt: now,
        tatIsRunning: true,
        tatLastTickAt: now,
        tatNetMinutes: 0,
        tatMaxMinutes: maxMinutes,
        tatBand: bandOf(0, maxMinutes),
      };
    }
    return null;
  }

  if (report.tatIsRunning) {
    // No prior tick stamp (started by an older build) → adopt now, no add.
    if (!report.tatLastTickAt) {
      return { tatLastTickAt: now };
    }
    const lastMin = localMinuteOfDay(
      toBranchLocalInstant(report.tatLastTickAt, timezone),
    );
    const elapsed = Math.round(
      (now.getTime() - report.tatLastTickAt.getTime()) / MS_PER_MINUTE,
    );
    // Never count past the window end this cycle (clamp to remaining window).
    const remaining = forwardMinutes(lastMin, toMin);
    const add = Math.max(0, Math.min(elapsed, remaining));

    // PAUSE — window has ended (independent of branch-open so it can't hang).
    if (!inWindow) {
      const net = (report.tatNetMinutes ?? 0) + add;
      return {
        tatIsRunning: false,
        tatNetMinutes: net,
        tatEndAt: now,
        tatLastTickAt: now,
        tatMaxMinutes: maxMinutes,
        tatBand: bandOf(net, maxMinutes),
      };
    }
    // ACCUMULATE — only while the branch is open (spec Step 1). When closed,
    // just advance the tick clock so the closed gap isn't counted on reopen.
    if (!branchOpen) {
      return { tatLastTickAt: now };
    }
    const net = (report.tatNetMinutes ?? 0) + add;
    return {
      tatNetMinutes: net,
      tatLastTickAt: now,
      tatMaxMinutes: maxMinutes,
      tatBand: bandOf(net, maxMinutes),
    };
  }

  // RESUME — paused report re-enters its window on an open scheduled day.
  if (branchOpen && inWindow) {
    return { tatIsRunning: true, tatLastTickAt: now };
  }
  return null;
}

/** Minute-of-day (0..1439) of a branch-local instant (UTC fields = local). */
export function localMinuteOfDay(local: Date): number {
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** True when `nowMin` is inside `[fromMin, toMin)`, wrapping past midnight. */
export function isInWindow(
  nowMin: number,
  fromMin: number,
  toMin: number,
): boolean {
  if (fromMin === toMin) return false; // zero-length window never opens
  if (fromMin < toMin) return nowMin >= fromMin && nowMin < toMin;
  return nowMin >= fromMin || nowMin < toMin; // wraps midnight
}

/** Forward minutes from `a` to `b` (0..1439), wrapping past midnight. */
export function forwardMinutes(a: number, b: number): number {
  return (((b - a) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Classify accumulated minutes into a Prisma `TatBand` (null if no max). */
export function bandOf(
  netMinutes: number,
  maxMinutes: number | null,
): TatBand | null {
  const band = classifyTat(netMinutes, maxMinutes);
  return band ? TatBand[band] : null;
}
