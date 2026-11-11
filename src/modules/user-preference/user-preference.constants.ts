/**
 * Screens that support a per-user default date filter. The key is part of the
 * route (`/user-preferences/date-filters/:screenKey`), so only these values are
 * accepted — anything else is a 400.
 */
export const DATE_FILTER_SCREEN_KEYS = [
  'registration-billings',
  'finance-billings',
  'registration-order-console',
  'accession-inhouse-orders',
  'accession-referral-orders',
  'technician-reporting',
] as const;
export type DateFilterScreenKey = (typeof DATE_FILTER_SCREEN_KEYS)[number];

/**
 * Saved date-filter presets. Every preset except `CUSTOM` is a range relative to
 * the business day at the moment the screen opens (resolved by the frontend), so
 * "Last 7 Days" keeps meaning the last seven days. `CUSTOM` stores fixed dates.
 * A user with no saved row opens the screen on the last 15 days (frontend fallback).
 */
export const DATE_FILTER_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_15_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'CUSTOM',
] as const;
export type DateFilterPreset = (typeof DATE_FILTER_PRESETS)[number];

/** Calendar date, `YYYY-MM-DD`. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
