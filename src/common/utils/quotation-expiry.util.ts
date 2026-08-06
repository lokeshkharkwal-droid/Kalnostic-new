import { RepeatIntervalUnit } from '@prisma/client';

/**
 * Date-interval math for quotation validity. Order dates are stored as
 * `@db.Date` (midnight UTC), so all arithmetic uses UTC calendar fields to stay
 * consistent with how the dates are persisted and compared.
 *
 * `HOURS` is supported for completeness (the shared `RepeatIntervalUnit` enum is
 * also used by lab-test repeat restrictions) even though the quotation UI only
 * offers Days/Weeks/Months/Years.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Return a new `Date` that is `value` units after `date`.
 * @param date the base instant.
 * @param value the (non-negative) number of units to add.
 * @param unit the interval unit.
 * @returns a new `Date` shifted forward by the interval (does not mutate `date`).
 */
export function addInterval(
  date: Date,
  value: number,
  unit: RepeatIntervalUnit,
): Date {
  const d = new Date(date.getTime());
  switch (unit) {
    case RepeatIntervalUnit.HOURS:
      return new Date(d.getTime() + value * MS_PER_HOUR);
    case RepeatIntervalUnit.DAYS:
      return new Date(d.getTime() + value * MS_PER_DAY);
    case RepeatIntervalUnit.WEEKS:
      return new Date(d.getTime() + value * 7 * MS_PER_DAY);
    case RepeatIntervalUnit.MONTHS:
      d.setUTCMonth(d.getUTCMonth() + value);
      return d;
    case RepeatIntervalUnit.YEARS:
      d.setUTCFullYear(d.getUTCFullYear() + value);
      return d;
  }
}

/**
 * Return a new `Date` that is `value` units before `date` (the inverse of
 * {@link addInterval}). Used to derive an expiry cutoff from "now".
 * @param date the base instant.
 * @param value the (non-negative) number of units to subtract.
 * @param unit the interval unit.
 * @returns a new `Date` shifted backward by the interval (does not mutate `date`).
 */
export function subtractInterval(
  date: Date,
  value: number,
  unit: RepeatIntervalUnit,
): Date {
  return addInterval(date, -value, unit);
}
