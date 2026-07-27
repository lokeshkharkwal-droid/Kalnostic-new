import { DayOfWeek } from '@prisma/client';
import { WorkingShift, workingMinutesBetween } from './tat-working-time.util';

const MS_PER_MINUTE = 60_000;

/**
 * The inputs that decide whether a branch is operational at a given instant.
 * `shifts` come from the branch's active `Schedule` (preferred); when there is
 * no active schedule covering the day, the fallback pair (`operationalDays` +
 * `openingTime`/`closingTime`) from the `Branch` row is used instead.
 */
export interface BranchOpenInputs {
  /** Active schedule shifts (engine shape). Empty ⇒ use the fallback below. */
  shifts: WorkingShift[];
  /** Branch operational weekdays (fallback when there are no shifts). */
  operationalDays: DayOfWeek[];
  /** Branch opening time "HH:mm" (fallback). */
  openingTime: string | null;
  /** Branch closing time "HH:mm" (fallback). */
  closingTime: string | null;
}

/**
 * Whether the branch is open at `nowLocal` (a branch-local instant per the TAT
 * engine's "UTC fields = branch-local wall clock" convention — convert real UTC
 * instants with `toBranchLocalInstant` first).
 *
 * Resolution order (matches the NABL spec Step 1):
 *  1. If the branch has an active `Schedule`, its shifts decide — the branch is
 *     open when `nowLocal` falls inside any shift window. **Breaks are ignored
 *     here** (a branch mid-break is still considered "open"; the NABL stopwatch
 *     window is the test's processing window, not the shift break).
 *  2. Otherwise fall back to the branch's `operationalDays` + opening/closing
 *     time — a single synthetic daily shift on those weekdays.
 *  3. When neither is configured, the branch is treated as closed.
 *
 * Implemented as a one-minute probe through the proven `workingMinutesBetween`
 * walk (with breaks stripped), so all the midnight-wrap / night-shift-spill
 * handling is shared with the TAT engine rather than re-derived here.
 */
export function isBranchOpenAt(
  nowLocal: Date,
  inputs: BranchOpenInputs,
): boolean {
  const shifts = resolveShifts(inputs);
  if (shifts.length === 0) return false;
  const probeEnd = new Date(nowLocal.getTime() + MS_PER_MINUTE);
  return workingMinutesBetween(nowLocal, probeEnd, { shifts }) > 0;
}

/**
 * The operating shifts to test against: the active-schedule shifts (breaks
 * stripped) when present, else a single synthetic shift built from the branch's
 * operational days + opening/closing time. Returns an empty array when nothing
 * usable is configured.
 */
function resolveShifts(inputs: BranchOpenInputs): WorkingShift[] {
  if (inputs.shifts.length > 0) {
    return inputs.shifts.map((s) => ({ ...s, breaks: [] }));
  }
  if (
    inputs.operationalDays.length > 0 &&
    inputs.openingTime &&
    inputs.closingTime
  ) {
    return [
      {
        startTime: inputs.openingTime,
        endTime: inputs.closingTime,
        breaks: [],
        activeDays: inputs.operationalDays,
      },
    ];
  }
  return [];
}
