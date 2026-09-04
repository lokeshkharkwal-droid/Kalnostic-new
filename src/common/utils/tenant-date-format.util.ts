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
