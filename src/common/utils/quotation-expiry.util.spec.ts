import { RepeatIntervalUnit } from '@prisma/client';
import { addInterval, subtractInterval } from './quotation-expiry.util';

/** All instants are UTC (order dates are stored @db.Date = midnight UTC). */
const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

describe('quotation-expiry util', () => {
  describe('addInterval', () => {
    it('adds days', () => {
      expect(addInterval(utc(2026, 8, 1), 7, RepeatIntervalUnit.DAYS)).toEqual(
        utc(2026, 8, 8),
      );
    });

    it('adds weeks', () => {
      expect(addInterval(utc(2026, 8, 1), 2, RepeatIntervalUnit.WEEKS)).toEqual(
        utc(2026, 8, 15),
      );
    });

    it('adds months', () => {
      expect(addInterval(utc(2026, 8, 1), 3, RepeatIntervalUnit.MONTHS)).toEqual(
        utc(2026, 11, 1),
      );
    });

    it('adds years', () => {
      expect(addInterval(utc(2026, 8, 1), 1, RepeatIntervalUnit.YEARS)).toEqual(
        utc(2027, 8, 1),
      );
    });

    it('does not mutate the input date', () => {
      const base = utc(2026, 8, 1);
      addInterval(base, 5, RepeatIntervalUnit.DAYS);
      expect(base).toEqual(utc(2026, 8, 1));
    });
  });

  describe('subtractInterval', () => {
    it('is the inverse of addInterval for days/weeks', () => {
      const now = utc(2026, 8, 20);
      expect(subtractInterval(now, 7, RepeatIntervalUnit.DAYS)).toEqual(
        utc(2026, 8, 13),
      );
      expect(subtractInterval(now, 1, RepeatIntervalUnit.WEEKS)).toEqual(
        utc(2026, 8, 13),
      );
    });

    it('derives an expiry cutoff usable as an order-date threshold', () => {
      // A quote with a 7-day validity is expired once its order date is older
      // than (now − 7 days). Order dated 2026-08-01, now 2026-08-20 → expired.
      const now = utc(2026, 8, 20);
      const cutoff = subtractInterval(now, 7, RepeatIntervalUnit.DAYS);
      const orderDate = utc(2026, 8, 1);
      expect(orderDate < cutoff).toBe(true);
    });
  });
});
