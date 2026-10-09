const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Prisma-compatible bounds for a DateTime column. */
export interface DateRangeBounds {
  gte?: Date;
  lt?: Date;
  lte?: Date;
}

/**
 * Turn a list screen's date-range filter into bounds for a **timestamp** column
 * (one that carries a time of day, e.g. `createdAt`, `sendDate`).
 *
 * The date picker sends plain days (`2026-10-06`). Read as an instant that is
 * 00:00 UTC, so using it as an inclusive upper bound drops the whole end day —
 * a single-day range matched nothing. A day-only `dateTo` therefore means "up to
 * the end of that day" (exclusive start of the next day). A value that already
 * carries a time is a precise instant and is kept as a plain inclusive bound.
 *
 * Do NOT use this for `@db.Date` columns such as `orders.order_date`: they have
 * no time part, so `lte dateTo` is already inclusive there.
 *
 * Returns `undefined` when neither bound is set.
 */
export function timestampRange(
  dateFrom?: string,
  dateTo?: string,
): DateRangeBounds | undefined {
  if (!dateFrom && !dateTo) return undefined;
  const bounds: DateRangeBounds = {};
  if (dateFrom) bounds.gte = new Date(dateFrom);
  if (dateTo) {
    if (DATE_ONLY.test(dateTo)) {
      const nextDay = new Date(`${dateTo}T00:00:00.000Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      bounds.lt = nextDay;
    } else {
      bounds.lte = new Date(dateTo);
    }
  }
  return bounds;
}
