import { AgeUnit } from '@prisma/client';

/**
 * Age-bound validation for reference ranges / reference values.
 *
 * A bound is a number plus a unit (Days / Months / Years) and the two bounds of
 * one range may use different units ("15 Days" to "1 Year"). Months and years
 * are calendar units of variable length, so they are never converted to a fixed
 * number of days; every comparison is done on calendar dates.
 *
 * Meaning of a range (agreed rule): **both ends are inclusive and the "To" bound
 * covers its whole unit**. For a baby born on date `DOB`, the range
 * `From .. To` covers every date `x` with
 *
 *     DOB + From  <=  x  <  DOB + (To + 1 unit)
 *
 * so "1 Month to 11 Months" includes a patient aged 11 months 20 days and stops
 * the day before the first birthday, and "0 Days to 28 Days" includes a newborn
 * aged 0 days and stops at day 29.
 *
 * A range is **valid** when that span is non-empty for every possible birth
 * date. Month arithmetic clamps to the last day of the month (31 Jan + 1 month
 * = 28/29 Feb), the same as java.time / dateutil / moment.
 */

/** One age bound as entered by the admin, e.g. `{ value: 15, unit: DAYS }`. */
export interface AgeBound {
  value: number;
  unit: AgeUnit;
}

/** A calendar date as plain integers (`m` is 1-12) — no time zone, no `Date` overflow. */
interface Ymd {
  y: number;
  m: number;
  d: number;
}

const MS_PER_DAY = 86_400_000;

/** Number of days in month `m` (1-12) of year `y`. */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Days since 1970-01-01 of a valid calendar date (a total order for comparing dates). */
function toDayNumber({ y, m, d }: Ymd): number {
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/**
 * Add an age bound to a birth date on the calendar and return the resulting
 * day number. Months and years clamp to the last valid day of the target month.
 *
 * @param dob birth date
 * @param bound the age to add (non-negative whole number + unit)
 * @returns the day number (days since 1970-01-01) reached
 */
export function addAgeBound(dob: Ymd, bound: AgeBound): number {
  switch (bound.unit) {
    case AgeUnit.DAYS:
      return toDayNumber(dob) + bound.value;
    case AgeUnit.MONTHS: {
      const index = dob.y * 12 + (dob.m - 1) + bound.value;
      const y = Math.floor(index / 12);
      const m = (index % 12) + 1;
      return toDayNumber({ y, m, d: Math.min(dob.d, daysInMonth(y, m)) });
    }
    case AgeUnit.YEARS: {
      const y = dob.y + bound.value;
      return toDayNumber({
        y,
        m: dob.m,
        d: Math.min(dob.d, daysInMonth(y, dob.m)),
      });
    }
  }
}

/**
 * Every day of one full 4-year calendar cycle that contains a leap day
 * (2024-01-01 .. 2027-12-31, 1461 dates). Month lengths and the leap day repeat
 * with this period, so a range that is empty for some birth date is empty for
 * one of these.
 */
const REFERENCE_DOBS: readonly Ymd[] = (() => {
  const dates: Ymd[] = [];
  for (let y = 2024; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      const last = daysInMonth(y, m);
      for (let d = 1; d <= last; d++) dates.push({ y, m, d });
    }
  }
  return dates;
})();

const validityCache = new Map<string, boolean>();

/**
 * Whether the range `from .. to` is non-empty for **every** birth date, under the
 * "To covers its whole unit" rule described above.
 *
 * Examples: `15 Days .. 1 Year` valid; `1 Year .. 12 Months` valid;
 * `1 Year .. 11 Months` invalid; `30 Days .. 1 Month` valid;
 * `1 Month .. 30 Days` invalid (empty for a baby born on 1 January).
 *
 * @param from lower bound (inclusive)
 * @param to upper bound (inclusive, covers its whole unit)
 */
export function isAgeRangeValid(from: AgeBound, to: AgeBound): boolean {
  const key = `${from.value}${from.unit}|${to.value}${to.unit}`;
  const cached = validityCache.get(key);
  if (cached !== undefined) return cached;
  const upper: AgeBound = { value: to.value + 1, unit: to.unit };
  const valid = REFERENCE_DOBS.every(
    (dob) => addAgeBound(dob, from) < addAgeBound(dob, upper),
  );
  validityCache.set(key, valid);
  return valid;
}

/** `"15 Days"`, `"1 Year"` — unit singularised for a value of 1, for messages. */
export function formatAgeBound(bound: AgeBound): string {
  const unit = bound.unit.charAt(0) + bound.unit.slice(1).toLowerCase();
  const singular = unit.slice(0, -1);
  return `${bound.value} ${bound.value === 1 ? singular : unit}`;
}

// ── Comparing two age ranges ──────────────────────────────────────────────────
//
// Used by the overlap check and the Default grouping so they agree with the
// calendar rule above instead of the old "month = 30 days, year = 365 days"
// approximation.

/** How two ranges relate over all possible birth dates. */
export type AgeOverlap =
  /** They never overlap, for any birth date. */
  | 'none'
  /** They overlap for some birth dates only (a calendar edge of a few days, e.g. "0-28 Days" next to "1-11 Months" for a baby born in February). Allowed. */
  | 'possible'
  /** They overlap for every birth date. A real overlap: rejected. */
  | 'definite';

/** Per reference birth date: the day number each range starts and ends (exclusive) on. */
interface RangeSpan {
  start: Int32Array;
  end: Int32Array;
}

const spanCache = new Map<string, RangeSpan>();

function spanOf(from: AgeBound, to: AgeBound): RangeSpan {
  const key = ageRangeKey(from, to);
  const cached = spanCache.get(key);
  if (cached) return cached;
  const upper: AgeBound = { value: to.value + 1, unit: to.unit };
  const start = new Int32Array(REFERENCE_DOBS.length);
  const end = new Int32Array(REFERENCE_DOBS.length);
  REFERENCE_DOBS.forEach((dob, i) => {
    start[i] = addAgeBound(dob, from);
    end[i] = addAgeBound(dob, upper);
  });
  const span = { start, end };
  spanCache.set(key, span);
  return span;
}

/**
 * Canonical text for one age bound: two bounds have the same key exactly when
 * they land on the same date for every birth date. Months and years are
 * interchangeable (12 months is always exactly 1 year), days are not, and a bound
 * of zero is the birth date itself whatever its unit.
 */
export function ageBoundKey(bound: AgeBound): string {
  if (bound.value === 0) return 'Z';
  if (bound.unit === AgeUnit.DAYS) return `D${bound.value}`;
  return `M${bound.unit === AgeUnit.YEARS ? bound.value * 12 : bound.value}`;
}

/**
 * Canonical text for a whole range (`From .. To`, "To" covering its whole unit):
 * equal keys mean the two ranges cover exactly the same ages for every birth
 * date. `1 Year .. 1 Year` and `12 Months .. 23 Months` have the same key;
 * `0 Years .. 1 Year` and `0 Days .. 1 Year` also do (a zero bound is the birth
 * date whatever its unit); `1 Year .. 2 Years` and `365 Days .. 2 Years` do not
 * (a year is not always 365 days).
 */
export function ageRangeKey(from: AgeBound, to: AgeBound): string {
  return `${ageBoundKey(from)}|${ageBoundKey({ value: to.value + 1, unit: to.unit })}`;
}

/**
 * Whether two age ranges overlap for no birth date, some, or all of them.
 * Overlap means they share at least one day of age.
 *
 * - `definite` is a real overlap ("0 to 3 Months" and "1 to 11 Months").
 * - `possible` is a calendar edge only: "0 to 28 Days" and "1 to 11 Months" share day
 *   28 for a baby born in February (one month later is only 28 days), and nothing
 *   for a baby born in January (one month is 31 days).
 *
 * @param aFrom lower bound of range A (inclusive)
 * @param aTo upper bound of range A (inclusive, covers its whole unit)
 * @param bFrom lower bound of range B (inclusive)
 * @param bTo upper bound of range B (inclusive, covers its whole unit)
 */
export function classifyAgeOverlap(
  aFrom: AgeBound,
  aTo: AgeBound,
  bFrom: AgeBound,
  bTo: AgeBound,
): AgeOverlap {
  const a = spanOf(aFrom, aTo);
  const b = spanOf(bFrom, bTo);
  let overlapping = 0;
  for (let i = 0; i < a.start.length; i++) {
    if (Math.max(a.start[i]!, b.start[i]!) < Math.min(a.end[i]!, b.end[i]!)) {
      overlapping++;
    }
  }
  if (overlapping === 0) return 'none';
  return overlapping === a.start.length ? 'definite' : 'possible';
}

// ── Matching a patient's stored age against a range ───────────────────────────

/** How a patient's stored age relates to a reference range. */
export type AgeMatch =
  /** The patient's age is inside the range whatever their exact birth date. */
  | 'match'
  /** The stored age is too coarse to be sure: it is inside the range for some birth dates only (it straddles a range edge, or sits on a calendar edge). */
  | 'partial'
  /** The patient's age is outside the range for every birth date. */
  | 'none';

/**
 * Whether a patient's stored age falls in a range, on the same calendar rule as
 * the range checks in master data.
 *
 * A patient's stored age is a whole number of completed units ("6 Months",
 * "34 Years", "30 Days"): their real age is from that many units up to, but not
 * including, one more. That is exactly the range `A unit .. A unit`, so a patient
 * is `match`ed when that span lies wholly inside the range for EVERY possible birth
 * date, `none` when it touches it for NO birth date, and `partial` in between.
 *
 * Examples: "34 Years" in `18..60 Years` is a match; "1 Year" against
 * `0..17 Months` and `18..23 Months` is partial for both (the stored age cannot say
 * which); "30 Days" against `1..11 Months` is partial (30 days is a month for a baby
 * born in February but not for one born in January).
 *
 * @param patient the stored age as a bound (value + unit); the value may be 0
 * @param from the range's lower bound
 * @param to the range's upper bound (inclusive, covers its whole unit)
 */
export function classifyAgeMatch(
  patient: AgeBound,
  from: AgeBound,
  to: AgeBound,
): AgeMatch {
  const p = spanOf(patient, patient);
  const r = spanOf(from, to);
  let inside = 0;
  let touching = 0;
  for (let i = 0; i < p.start.length; i++) {
    if (p.start[i]! >= r.start[i]! && p.end[i]! <= r.end[i]!) inside++;
    if (Math.max(p.start[i]!, r.start[i]!) < Math.min(p.end[i]!, r.end[i]!)) {
      touching++;
    }
  }
  if (inside === p.start.length) return 'match';
  return touching === 0 ? 'none' : 'partial';
}
