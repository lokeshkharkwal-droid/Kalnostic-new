import { DayOfWeek, TatUnit } from '@prisma/client';

/**
 * Pure, DB-free core of the Turnaround-Time (TAT) engine.
 *
 * The SRS (`Turnaround Time.pdf`) defines Analytical TAT as the **working time**
 * between "Sample Accepted for Processing" and "Report Approved" — i.e. wall-clock
 * elapsed time **minus** non-operational hours and break periods (SRS §4.2, §9),
 * skipping days the test is not scheduled to run (SRS §5.1). This module computes
 * that net working time and classifies it against the test's configured TAT.
 *
 * ── Timezone contract ──────────────────────────────────────────────────────
 * These functions are timezone-agnostic on purpose: they treat each `Date`'s
 * **UTC calendar fields** as the branch-local wall clock, and shift/break `HH:mm`
 * strings as the same local clock. The caller (the future `TatService`) is
 * responsible for shifting real UTC instants into branch-local space before
 * calling in. Operating in UTC-space here means the math has **no DST edge
 * cases**, which keeps this core small and exhaustively testable.
 */

/** Minutes in a day — used for all midnight-aware clock maths. */
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

/**
 * Hard cap on the number of days the working-time walk will scan, so a report
 * that never gets approved (open-ended `end = now`) can't spin forever. 400 days
 * comfortably covers the longest realistic TAT (e.g. Culture, 48–72h) with room
 * to spare; a span longer than this returns the working time of the first 400
 * days rather than looping.
 */
const MAX_SCAN_DAYS = 400;

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

/** A break window inside a shift. Times are 24h `HH:mm`, branch-local. */
export interface WorkingBreak {
  startTime: string;
  endTime: string;
}

/**
 * One operating window on the days it runs. Mirrors the branch `Schedule`
 * module's shift shape, but generalised to zero-or-more breaks so the engine
 * doesn't care how breaks are stored upstream. `endTime <= startTime` means the
 * shift crosses midnight (e.g. NIGHT `22:00`–`06:00`), in which case it runs
 * from `startTime` on its active day into the following morning.
 */
export interface WorkingShift {
  startTime: string;
  endTime: string;
  breaks: WorkingBreak[];
  /** Days of the week this shift *starts* on. */
  activeDays: DayOfWeek[];
}

/**
 * The operating calendar the engine accrues working time against.
 * `scheduledDays` is the test-level restriction (SRS §5.1 "Scheduled Days"):
 * when non-empty, only shifts *starting* on one of these days count. Empty/
 * omitted means the test runs on every day its shifts run.
 */
export interface WorkingCalendar {
  shifts: WorkingShift[];
  scheduledDays?: DayOfWeek[];
}

/** The four TAT bands (matches the existing Accession `TatStatus`). */
export type TatBand = 'WITHIN' | 'WARNING' | 'CRITICAL' | 'BREACHED';

/**
 * Where the WARNING and CRITICAL bands begin, as fractions of the configured
 * **Maximum** TAT. `> max` is always BREACHED. Defaults: warn at 75% of max,
 * critical at 90%. Overridable per branch (a future TAT setting).
 */
export interface TatThresholds {
  warningRatio: number;
  criticalRatio: number;
}

export const DEFAULT_TAT_THRESHOLDS: TatThresholds = {
  warningRatio: 0.75,
  criticalRatio: 0.9,
};

/** Result of evaluating one report's TAT. */
export interface TatEvaluation {
  /** Net working minutes accrued between accept and approve (or "now"). */
  netMinutes: number;
  /** The configured Maximum TAT expressed in minutes (null if unconfigured). */
  maxTatMinutes: number | null;
  /** The band, or `null` when no Maximum TAT is configured to compare against. */
  band: TatBand | null;
}

// ── Small clock helpers (shared shape with ScheduleService) ──────────────────

/** Convert an `HH:mm` string to minutes since midnight (0..1439). */
export function hhmmToMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Forward duration from `start` to `end` in minutes, wrapping midnight (1..1440). */
function durationFrom(start: number, end: number): number {
  return ((end - start + MINUTES_PER_DAY - 1) % MINUTES_PER_DAY) + 1;
}

/** Forward offset of `point` from `start` in minutes, wrapping midnight (0..1439). */
function offsetFrom(start: number, point: number): number {
  return (point - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** UTC-midnight epoch-ms for the calendar day containing `ms`. */
function utcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Re-express a real UTC instant as the engine's "UTC-fields = branch-local wall
 * clock" convention: returns a `Date` whose UTC calendar fields equal what a
 * clock in `timeZone` reads at `instant`. Feed the result (together with an
 * identically-converted end) into {@link workingMinutesBetween} so the shift
 * `HH:mm` windows line up with the branch's real local time.
 *
 * A null/empty `timeZone` returns the instant unchanged (treat DB time as
 * already branch-local — the app-default fallback).
 * @param instant a real UTC instant (e.g. `acceptedAt` straight from the DB)
 * @param timeZone an IANA zone (e.g. "Asia/Kolkata"), or null to pass through
 */
export function toBranchLocalInstant(
  instant: Date,
  timeZone: string | null | undefined,
): Date {
  if (!timeZone) return instant;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const val = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type)?.value ?? '0';
    return Number(found);
  };
  // Some ICU builds render midnight as hour "24"; normalise to 0.
  const hour = val('hour') % 24;
  return new Date(
    Date.UTC(
      val('year'),
      val('month') - 1,
      val('day'),
      hour,
      val('minute'),
      val('second'),
    ),
  );
}

/**
 * Remove `[cutStart, cutEnd)` from a set of `[start, end)` epoch-ms intervals,
 * splitting any interval the cut lands inside. Used to punch breaks out of a
 * shift occurrence.
 */
function subtractInterval(
  segments: Array<[number, number]>,
  cutStart: number,
  cutEnd: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [s, e] of segments) {
    if (cutEnd <= s || cutStart >= e) {
      out.push([s, e]); // no overlap
      continue;
    }
    if (cutStart > s) out.push([s, cutStart]);
    if (cutEnd < e) out.push([cutEnd, e]);
  }
  return out;
}

/**
 * Total minutes covered by a set of `[start, end)` epoch-ms intervals, counting
 * overlaps once (union). Defensive against any accidental double-coverage from
 * two shifts on the same day.
 */
function unionMinutes(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let totalMs = 0;
  let [curStart, curEnd] = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i]!;
    if (s > curEnd) {
      totalMs += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  totalMs += curEnd - curStart;
  return totalMs / MS_PER_MINUTE;
}

// ── The engine ───────────────────────────────────────────────────────────────

/**
 * Net working minutes between two branch-local instants, counting only time that
 * is inside an operating shift, outside every break, and on a scheduled day.
 *
 * The walk generates each shift's concrete occurrence (start day at `startTime`,
 * lasting its wrap-aware duration), punches out breaks, clips to `[start, end)`,
 * then unions everything so overlaps never double-count. It begins one day before
 * `start` so a night shift that began the previous evening and spills past
 * midnight into `start` is still counted.
 *
 * @param start branch-local accept instant (see the module's timezone contract)
 * @param end branch-local approve instant, or "now" for an in-flight report
 * @param calendar operating shifts (+breaks) and the test's scheduled days
 * @returns net working minutes (0 when `end <= start` or nothing operates)
 */
export function workingMinutesBetween(
  start: Date,
  end: Date,
  calendar: WorkingCalendar,
): number {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (endMs <= startMs) return 0;
  if (calendar.shifts.length === 0) return 0;

  const scheduled =
    calendar.scheduledDays && calendar.scheduledDays.length > 0
      ? new Set(calendar.scheduledDays)
      : null;

  const intervals: Array<[number, number]> = [];
  const lastDay = utcMidnight(endMs);
  let dayCursor = utcMidnight(startMs) - MS_PER_DAY; // start one day early (night-shift spill)
  let scanned = 0;

  while (dayCursor <= lastDay && scanned < MAX_SCAN_DAYS) {
    const dow = WEEKDAY_BY_UTC_DAY[new Date(dayCursor).getUTCDay()];
    if (dow && (!scheduled || scheduled.has(dow))) {
      for (const shift of calendar.shifts) {
        if (!shift.activeDays.includes(dow)) continue;

        const shiftStartMin = hhmmToMinutes(shift.startTime);
        const shiftLen = durationFrom(
          shiftStartMin,
          hhmmToMinutes(shift.endTime),
        );
        const occStart = dayCursor + shiftStartMin * MS_PER_MINUTE;
        const occEnd = occStart + shiftLen * MS_PER_MINUTE;

        let segments: Array<[number, number]> = [[occStart, occEnd]];
        for (const br of shift.breaks) {
          const brStartMin = hhmmToMinutes(br.startTime);
          const brOffset = offsetFrom(shiftStartMin, brStartMin);
          const brLen = durationFrom(brStartMin, hhmmToMinutes(br.endTime));
          const brStart = occStart + brOffset * MS_PER_MINUTE;
          segments = subtractInterval(
            segments,
            brStart,
            brStart + brLen * MS_PER_MINUTE,
          );
        }

        for (const [s, e] of segments) {
          const cs = Math.max(s, startMs);
          const ce = Math.min(e, endMs);
          if (ce > cs) intervals.push([cs, ce]);
        }
      }
    }
    dayCursor += MS_PER_DAY;
    scanned++;
  }

  return unionMinutes(intervals);
}

/**
 * Convert a configured TAT value+unit into minutes. Per the agreed convention
 * `1 day = 24h`, `1 hour = 60m`; the resulting minutes are compared against
 * **net working** minutes (so "8 hours" means 8 working hours, not wall-clock).
 * @returns the value in minutes, or `null` if either input is missing
 */
export function tatUnitToMinutes(
  value: number | null | undefined,
  unit: TatUnit | null | undefined,
): number | null {
  if (value == null || unit == null) return null;
  switch (unit) {
    case TatUnit.MINUTES:
      return value;
    case TatUnit.HOURS:
      return value * 60;
    case TatUnit.DAYS:
      return value * MINUTES_PER_DAY;
  }
}

/**
 * Classify net working minutes into a TAT band against the configured Maximum
 * TAT. Returns `null` when there is no configured maximum to compare against.
 * `> max` is BREACHED; the WARNING/CRITICAL cutoffs are fractions of max.
 * @param netMinutes net working minutes accrued
 * @param maxTatMinutes configured Maximum TAT in minutes (null = unconfigured)
 * @param thresholds warning/critical ratios of max (defaults 0.75 / 0.9)
 */
export function classifyTat(
  netMinutes: number,
  maxTatMinutes: number | null,
  thresholds: TatThresholds = DEFAULT_TAT_THRESHOLDS,
): TatBand | null {
  if (maxTatMinutes == null || maxTatMinutes <= 0) return null;
  if (netMinutes > maxTatMinutes) return 'BREACHED';
  if (netMinutes >= maxTatMinutes * thresholds.criticalRatio) return 'CRITICAL';
  if (netMinutes >= maxTatMinutes * thresholds.warningRatio) return 'WARNING';
  return 'WITHIN';
}

/**
 * End-to-end evaluation for one report: compute net working time and classify it
 * against the configured Maximum TAT. A convenience wrapper over
 * {@link workingMinutesBetween}, {@link tatUnitToMinutes} and {@link classifyTat}.
 * @param start branch-local accept instant
 * @param end branch-local approve instant (or "now" for in-flight)
 * @param calendar operating shifts + scheduled days
 * @param maxTatValue configured Maximum TAT value (from the branch lab test)
 * @param maxTatUnit configured Maximum TAT unit
 * @param thresholds optional warning/critical ratios
 */
export function evaluateTat(
  start: Date,
  end: Date,
  calendar: WorkingCalendar,
  maxTatValue: number | null | undefined,
  maxTatUnit: TatUnit | null | undefined,
  thresholds: TatThresholds = DEFAULT_TAT_THRESHOLDS,
): TatEvaluation {
  const netMinutes = workingMinutesBetween(start, end, calendar);
  const maxTatMinutes = tatUnitToMinutes(maxTatValue, maxTatUnit);
  return {
    netMinutes,
    maxTatMinutes,
    band: classifyTat(netMinutes, maxTatMinutes, thresholds),
  };
}
