import { AgeUnit } from '@prisma/client';
import { formatAgeBound } from './age-bounds.util';
import { completedAge, dobInAgeBand } from './age-dob.util';

/**
 * Lab test "Age Restriction" helpers (Master Data → Basic Details), shared by
 * Create-Order enforcement. A restricted test may only be ordered for a patient
 * whose age on the order date lies inside `min .. max` — the reference-range
 * calendar rule: the lower bound is inclusive and the upper bound covers its
 * whole unit ("Max 18 Years" still admits someone aged 18 years 364 days).
 */

/** A test's allowed age range (both bounds present). */
export interface AgeLimit {
  minAgeValue: number;
  minAgeUnit: AgeUnit;
  maxAgeValue: number;
  maxAgeUnit: AgeUnit;
}

/** The Age Restriction columns as stored on `lab_test` / `branch_lab_tests`. */
export interface AgeRestrictionFields {
  isAgeRestricted: boolean;
  minAgeValue: number | null;
  minAgeUnit: AgeUnit | null;
  maxAgeValue: number | null;
  maxAgeUnit: AgeUnit | null;
}

/**
 * The allowed range of a restricted test, or `null` when the test has no age
 * limit (flag off, or — defensively — a bound missing).
 * @param row the stored Age Restriction columns
 */
export function toAgeLimit(row: AgeRestrictionFields): AgeLimit | null {
  if (
    !row.isAgeRestricted ||
    row.minAgeValue === null ||
    row.minAgeUnit === null ||
    row.maxAgeValue === null ||
    row.maxAgeUnit === null
  ) {
    return null;
  }
  return {
    minAgeValue: row.minAgeValue,
    minAgeUnit: row.minAgeUnit,
    maxAgeValue: row.maxAgeValue,
    maxAgeUnit: row.maxAgeUnit,
  };
}

/**
 * Whether a patient born on `dob` meets an age limit on `onDay`.
 * @param dob the patient's (exact or implied) date of birth, UTC midnight
 * @param onDay the order date, UTC midnight
 * @param limit the test's allowed range
 * @returns `false` also when `onDay` is before `dob` (not born yet)
 */
export function meetsAgeLimit(
  dob: Date,
  onDay: Date,
  limit: AgeLimit,
): boolean {
  return (
    dobInAgeBand(dob, onDay, {
      ageFrom: limit.minAgeValue,
      ageFromUnit: limit.minAgeUnit,
      ageTo: limit.maxAgeValue,
      ageToUnit: limit.maxAgeUnit,
    }) === true
  );
}

/**
 * `"18 Years - 60 Years"` — both bounds, each with its own unit (same text as
 * the frontend's `formatApiAgeRange`).
 * @param limit the allowed range
 */
export function formatAgeLimit(limit: AgeLimit): string {
  return `${formatAgeBound({ value: limit.minAgeValue, unit: limit.minAgeUnit })} - ${formatAgeBound({ value: limit.maxAgeValue, unit: limit.maxAgeUnit })}`;
}

/**
 * The patient's age on `onDay` in the registration display unit (≤31 days →
 * Days, ≤12 months → Months, else Years — the frontend `computeAgeFromDob`
 * rule), e.g. `"5 Years"`. `null` when `onDay` is before `dob`.
 * @param dob date of birth, UTC midnight
 * @param onDay the day the age is taken on, UTC midnight
 */
export function formatAgeOn(dob: Date, onDay: Date): string | null {
  const done = completedAge(dob, onDay);
  if (!done) return null;
  if (done.days <= 31) {
    return formatAgeBound({ value: done.days, unit: AgeUnit.DAYS });
  }
  if (done.months <= 12) {
    return formatAgeBound({ value: done.months, unit: AgeUnit.MONTHS });
  }
  return formatAgeBound({ value: done.years, unit: AgeUnit.YEARS });
}

/**
 * The calendar day of an order date as UTC midnight. Create Order sends the
 * business-local date encoded as `YYYY-MM-DDT00:00:00.000Z`, and stored
 * `orders.order_date` values are UTC midnight too, so the UTC date parts ARE
 * the order's day.
 * @param value the DTO's ISO string or the stored `Date`
 * @returns `null` for an unparsable value
 */
export function orderDayOf(value: string | Date): Date | null {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}
