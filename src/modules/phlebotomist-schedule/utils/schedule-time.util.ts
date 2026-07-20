import { DayOfWeek } from '@prisma/client';

/** 24-hour `HH:mm` clock time, e.g. `09:00`, `17:30`. */
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes in a day. */
export const MINUTES_PER_DAY = 24 * 60;

/** Convert an `HH:mm` string to minutes since midnight (0..1439). */
export function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Convert minutes since midnight (0..1439) back to an `HH:mm` string. */
export function fromMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Day-of-week index (0 = Sunday … 6 = Saturday, matching `Date.getUTCDay()`)
 * for each Prisma `DayOfWeek`.
 */
const INDEX_TO_DOW: DayOfWeek[] = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** The Prisma `DayOfWeek` for a date (computed in UTC). */
export function dayOfWeekOf(date: Date): DayOfWeek {
  return INDEX_TO_DOW[date.getUTCDay()] as DayOfWeek;
}

/** The English day name for a date (computed in UTC), e.g. `Monday`. */
export function dayNameOf(date: Date): string {
  return DAY_NAMES[date.getUTCDay()] as string;
}

/** True when a date falls on a Sunday (computed in UTC). */
export function isSunday(date: Date): boolean {
  return date.getUTCDay() === 0;
}

/**
 * Parse a `YYYY-MM-DD` (or ISO) string into a UTC calendar date at midnight,
 * dropping any time component so date-only comparisons are timezone-stable.
 */
export function toUtcDateOnly(value: string): Date {
  const d = new Date(value);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** Normalise a Date to UTC midnight of the same calendar day. */
export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** A new UTC-midnight date `n` days after `date` (n may be negative). */
export function addDays(date: Date, n: number): Date {
  const d = startOfUtcDay(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** Format a Date as `YYYY-MM-DD` (UTC). */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Minutes-since-midnight of a Date, in UTC (0..1439). Used to bucket a visit's
 * `collectionAt`/`appointmentAt` timestamp into a slot's `HH:mm` window.
 */
export function utcMinutesOf(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/**
 * Mask a phone number for display, keeping the last two digits and hiding the
 * middle — e.g. `+91 9876543210` → `+91 98xxxxxx10`. Returns `null` for a
 * missing number and leaves very short values unmasked.
 */
export function maskMobile(phone: string | null): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 4) return trimmed;
  const last2 = digits.slice(-2);
  const prefix = digits.slice(0, 2);
  const hidden = 'x'.repeat(Math.max(0, digits.length - 4));
  const masked = `${prefix}${hidden}${last2}`;
  // Preserve a leading country-code group when the input had one (e.g. "+91 ").
  const ccMatch = trimmed.match(/^(\+\d{1,3})[\s-]/);
  return ccMatch ? `${ccMatch[1]} ${masked}` : masked;
}
