/**
 * Render a tenant-local wall-clock `Date` (see {@link toBranchLocalInstant} —
 * caller must convert first; this module reads UTC getters under that
 * convention, it does not itself apply any timezone) per a Site-Admin
 * -configured `date_format` (a free-text pattern like `"DD/MM/YYYY"` — see
 * `TenantSettingsDto.date_format`, no enum, so this must tolerate an
 * unrecognized pattern gracefully rather than throwing) and `time_format`
 * (`'12h'` | `'24h'`, validated by `SUPPORTED_TIME_FORMATS`).
 *
 * Recognized date tokens: `YYYY`/`YY` (year), `MM` (2-digit month), `DD`
 * (2-digit day) — combined with whatever separator the tenant used between
 * them (`/`, `-`, `.`, space). Any other pattern falls back to
 * {@link DEFAULT_DATE_FORMAT}'s output rather than emitting garbled text.
 */
import { toBranchLocalInstant } from './tat-working-time.util';

const DEFAULT_DATE_FORMAT = 'DD/MM/YYYY';

const DATE_TOKEN_PATTERN = /YYYY|YY|MM|DD/g;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format the date-only part of a tenant-local wall-clock instant (already
 * converted via `toBranchLocalInstant`) per `dateFormat`. Reads UTC getters —
 * see module doc.
 */
export function formatTenantDate(
  localInstant: Date,
  dateFormat: string,
): string {
  const pattern = DATE_TOKEN_PATTERN.test(dateFormat)
    ? dateFormat
    : DEFAULT_DATE_FORMAT;
  // Reset lastIndex after the .test() above (global regex retains state).
  DATE_TOKEN_PATTERN.lastIndex = 0;

  const year = localInstant.getUTCFullYear();
  const month = localInstant.getUTCMonth() + 1;
  const day = localInstant.getUTCDate();

  return pattern.replace(DATE_TOKEN_PATTERN, (token) => {
    switch (token) {
      case 'YYYY':
        return String(year);
      case 'YY':
        return String(year).slice(-2);
      case 'MM':
        return pad2(month);
      case 'DD':
        return pad2(day);
      default:
        return token;
    }
  });
}

/**
 * Format the time-of-day part of a tenant-local wall-clock instant (already
 * converted via `toBranchLocalInstant`) per `timeFormat` (`'12h'` ->
 * `"03:30 PM"`, `'24h'` -> `"15:30"`). Reads UTC getters — see module doc.
 */
export function formatTenantTime(
  localInstant: Date,
  timeFormat: string,
): string {
  const hours24 = localInstant.getUTCHours();
  const minutes = pad2(localInstant.getUTCMinutes());

  if (timeFormat === '24h') {
    return `${pad2(hours24)}:${minutes}`;
  }

  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${minutes} ${period}`;
}

/** Combine {@link formatTenantDate} and {@link formatTenantTime} as `"<date>, <time>"`. */
export function formatTenantDateTime(
  localInstant: Date,
  dateFormat: string,
  timeFormat: string,
): string {
  return `${formatTenantDate(localInstant, dateFormat)}, ${formatTenantTime(localInstant, timeFormat)}`;
}

/**
 * Combine an order's date-only `orderDate` (`@db.Date`, stored at midnight) with
 * its operator-entered `orderTime` (`"HH:mm"`) into one `"<date> <time>"` display
 * value — e.g. `21/09/2026 01:30 PM` — for the `{order_date_time}` tag. Uses the
 * same `<date> <space> <time>` layout as the `{collected_at}` label so the two
 * date-time tags read identically (date per tenant `dateFormat`; time per tenant
 * `12h`/`24h`). Both inputs are already branch-local wall-clock values entered by
 * the operator, so — unlike real UTC instants (`collectedAt`) — no
 * `toBranchLocalInstant` conversion is applied. A missing/malformed `orderTime`
 * falls back to `00:00`. Used by the bill/TRF documents; lab reports use
 * {@link formatOrderPrintDateTime}, which falls back to the order's real
 * creation time instead.
 */
export function formatOrderDateTime(
  orderDate: Date,
  orderTime: string | null | undefined,
  dateFormat: string,
  timeFormat: string,
): string {
  const [hours, minutes] = (orderTime ?? '00:00')
    .split(':')
    .map((n) => Number(n) || 0);
  const combined = combineOrderDateTime(orderDate, hours, minutes);
  return `${formatTenantDate(combined, dateFormat)} ${formatTenantTime(combined, timeFormat)}`;
}

/** `orderDate`'s calendar day at `hours:minutes`, as a wall-clock instant (UTC getters). */
function combineOrderDateTime(
  orderDate: Date,
  hours: number | undefined,
  minutes: number | undefined,
): Date {
  return new Date(
    Date.UTC(
      orderDate.getUTCFullYear(),
      orderDate.getUTCMonth(),
      orderDate.getUTCDate(),
      hours,
      minutes,
    ),
  );
}

/** A strictly valid operator-entered `"HH:mm"` order time, or null. */
const ORDER_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True when two wall-clock instants fall on the same UTC-getter calendar day. */
function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** The order fields {@link resolveOrderLocalDateTime} reads. */
export interface OrderDateTimeSource {
  /** Date-only order date (`@db.Date`, stored at UTC midnight). */
  orderDate: Date;
  /** Optional operator-entered order time, `"HH:mm"` branch-local. */
  orderTime: string | null | undefined;
  /** The real UTC instant the order was created. */
  createdAt: Date;
}

/**
 * The order's tenant-local wall-clock moment for the lab report's
 * `{order_date}` / `{order_date_time}` tags (read via UTC getters, like every
 * formatter in this module), and whether that moment carries a real time:
 *  1. An operator-entered `orderTime` (`"HH:mm"`, only captured when the branch
 *     allows editing the order date) wins, combined with `orderDate` as-is —
 *     both are already branch-local, so no timezone conversion.
 *  2. Otherwise, when `orderDate` is the day the order was created — matched
 *     against `createdAt`'s UTC day (the registration form defaults the date
 *     from the browser's UTC day) or its tenant-local day — the order was
 *     placed "now", so `createdAt` converted to the tenant timezone is the
 *     exact order date and time. This also corrects the date of an order
 *     placed between local midnight and the UTC rollover, whose stored
 *     `orderDate` is the previous day.
 *  3. Otherwise the order was back- or advance-dated without a time: the
 *     chosen `orderDate`, with `hasTime: false` (no real time exists).
 * @param order the order's date, optional time and creation instant
 * @param timezone the tenant/branch IANA zone (null → `createdAt` as-is)
 */
export function resolveOrderLocalDateTime(
  order: OrderDateTimeSource,
  timezone: string | null | undefined,
): { local: Date; hasTime: boolean } {
  const typed = ORDER_TIME_PATTERN.exec(order.orderTime?.trim() ?? '');
  if (typed) {
    return {
      local: combineOrderDateTime(
        order.orderDate,
        Number(typed[1]),
        Number(typed[2]),
      ),
      hasTime: true,
    };
  }
  const createdLocal = toBranchLocalInstant(order.createdAt, timezone);
  if (
    sameUtcDay(order.orderDate, order.createdAt) ||
    sameUtcDay(order.orderDate, createdLocal)
  ) {
    return { local: createdLocal, hasTime: true };
  }
  return { local: order.orderDate, hasTime: false };
}

/**
 * The lab report's `{order_date}` — the order's date per the tenant
 * `dateFormat`, resolved by {@link resolveOrderLocalDateTime}.
 */
export function formatOrderPrintDate(
  order: OrderDateTimeSource,
  timezone: string | null | undefined,
  dateFormat: string,
): string {
  return formatTenantDate(
    resolveOrderLocalDateTime(order, timezone).local,
    dateFormat,
  );
}

/**
 * The lab report's `{order_date_time}` — `"<date> <time>"` per the tenant
 * `dateFormat`/`timeFormat` (same layout as {@link formatOrderDateTime}),
 * resolved by {@link resolveOrderLocalDateTime}. A back/advance-dated order
 * with no entered time prints its date only rather than a made-up time.
 */
export function formatOrderPrintDateTime(
  order: OrderDateTimeSource,
  timezone: string | null | undefined,
  dateFormat: string,
  timeFormat: string,
): string {
  const { local, hasTime } = resolveOrderLocalDateTime(order, timezone);
  const date = formatTenantDate(local, dateFormat);
  return hasTime ? `${date} ${formatTenantTime(local, timeFormat)}` : date;
}

/**
 * Fixed lab-report date-time stamp: `DD-MM-YYYY hh:mm AM/PM` (e.g.
 * `05-09-2026 03:30 PM`). Unlike {@link formatTenantDateTime} this ignores the
 * tenant's `date_format`/`time_format` and always emits the report layout the
 * business requires for `{order_date}`, `{sample_collection_date}`,
 * `{sample_received_date}`, `{last_report_prepared_on}` and the Latte
 * all-reports header. Reads UTC getters under the same convention as the rest
 * of this module — the caller must convert to a tenant-local wall-clock instant
 * via `toBranchLocalInstant` first. Empty string for a null/invalid instant.
 */
export function formatReportDateTime(
  localInstant: Date | null | undefined,
): string {
  if (!localInstant || Number.isNaN(localInstant.getTime())) {
    return '';
  }
  const day = pad2(localInstant.getUTCDate());
  const month = pad2(localInstant.getUTCMonth() + 1);
  const year = localInstant.getUTCFullYear();
  const hours24 = localInstant.getUTCHours();
  const minutes = pad2(localInstant.getUTCMinutes());
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${day}-${month}-${year} ${pad2(hours12)}:${minutes} ${period}`;
}
