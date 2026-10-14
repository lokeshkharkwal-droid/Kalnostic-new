import { OrderDateType } from '@prisma/client';
import {
  classifyOrderDate,
  formatOrderDateTime,
  formatOrderPrintDate,
  formatOrderPrintDateTime,
  resolveOrderLocalDateTime,
} from './tenant-date-format.util';

/** UTC-midnight date, the shape Prisma returns for a `@db.Date` column. */
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const IST = 'Asia/Kolkata';
const FMT = 'DD/MM/YYYY';

describe('formatOrderPrintDateTime / formatOrderPrintDate', () => {
  it("prints the order's creation time in the tenant timezone when no time was typed", () => {
    // ORD-00125: created 2026-10-01 08:54:59 UTC = 14:24 IST.
    const order = {
      orderDate: d('2026-10-01'),
      orderTime: null,
      createdAt: new Date('2026-10-01T08:54:59Z'),
    };
    expect(formatOrderPrintDateTime(order, IST, FMT, '12h')).toBe(
      '01/10/2026 2:24 PM',
    );
    expect(formatOrderPrintDateTime(order, IST, FMT, '24h')).toBe(
      '01/10/2026 14:24',
    );
    expect(formatOrderPrintDate(order, IST, FMT)).toBe('01/10/2026');
  });

  it('corrects the date of an order placed between local midnight and the UTC rollover', () => {
    // Created 2026-09-07 01:33 IST; the form stored the UTC day (2026-09-06).
    const order = {
      orderDate: d('2026-09-06'),
      orderTime: undefined,
      createdAt: new Date('2026-09-06T20:03:00Z'),
    };
    expect(formatOrderPrintDateTime(order, IST, FMT, '12h')).toBe(
      '07/09/2026 1:33 AM',
    );
    expect(formatOrderPrintDate(order, IST, FMT)).toBe('07/09/2026');
  });

  it('also matches an order date stored as the local day', () => {
    const order = {
      orderDate: d('2026-09-07'),
      orderTime: null,
      createdAt: new Date('2026-09-06T20:03:00Z'),
    };
    expect(formatOrderPrintDateTime(order, IST, FMT, '12h')).toBe(
      '07/09/2026 1:33 AM',
    );
  });

  it('uses an operator-typed order time with the chosen order date', () => {
    const order = {
      orderDate: d('2026-09-21'),
      orderTime: '13:30',
      createdAt: new Date('2026-09-25T08:00:00Z'),
    };
    expect(formatOrderPrintDateTime(order, IST, FMT, '12h')).toBe(
      '21/09/2026 1:30 PM',
    );
    expect(formatOrderPrintDate(order, IST, FMT)).toBe('21/09/2026');
  });

  it('prints only the date for a back-dated order with no typed time', () => {
    const order = {
      orderDate: d('2026-09-01'),
      orderTime: null,
      createdAt: new Date('2026-09-05T06:00:00Z'),
    };
    expect(formatOrderPrintDateTime(order, IST, FMT, '12h')).toBe('01/09/2026');
    expect(resolveOrderLocalDateTime(order, IST).hasTime).toBe(false);
  });

  it('ignores a malformed typed time', () => {
    const order = {
      orderDate: d('2026-10-01'),
      orderTime: '25:99',
      createdAt: new Date('2026-10-01T08:54:59Z'),
    };
    expect(formatOrderPrintDateTime(order, IST, FMT, '12h')).toBe(
      '01/10/2026 2:24 PM',
    );
  });

  it('treats createdAt as already local when no timezone is configured', () => {
    const order = {
      orderDate: d('2026-10-01'),
      orderTime: null,
      createdAt: new Date('2026-10-01T08:54:59Z'),
    };
    expect(formatOrderPrintDateTime(order, null, FMT, '12h')).toBe(
      '01/10/2026 8:54 AM',
    );
  });
});

describe('formatOrderDateTime (bill/TRF) is unchanged', () => {
  it('combines orderDate with orderTime, midnight when unset', () => {
    expect(formatOrderDateTime(d('2026-09-21'), '13:30', FMT, '12h')).toBe(
      '21/09/2026 1:30 PM',
    );
    expect(formatOrderDateTime(d('2026-09-21'), null, FMT, '12h')).toBe(
      '21/09/2026 12:00 AM',
    );
  });
});

describe('classifyOrderDate — tenant-local "today"', () => {
  it('an order placed just after local midnight (east of UTC) is CURRENT, not ADVANCE_DATED', () => {
    // 00:30 IST on the 14th — UTC is still 19:00 on the 13th.
    const now = new Date('2026-10-13T19:00:00Z');
    expect(classifyOrderDate('2026-10-14', IST, now)).toBe(
      OrderDateType.CURRENT,
    );
    // The bug it fixes: comparing against the server's UTC day flips it.
    expect(classifyOrderDate('2026-10-14', null, now)).toBe(
      OrderDateType.ADVANCE_DATED,
    );
  });

  it('an evening order (west of UTC) is CURRENT, not BACKTRACKED', () => {
    // 22:00 America/New_York on the 13th — UTC has already rolled to the 14th.
    const now = new Date('2026-10-14T02:00:00Z');
    expect(classifyOrderDate('2026-10-13', 'America/New_York', now)).toBe(
      OrderDateType.CURRENT,
    );
    expect(classifyOrderDate('2026-10-13', null, now)).toBe(
      OrderDateType.BACKTRACKED,
    );
  });

  it('still buckets genuinely past / future order dates', () => {
    const now = new Date('2026-10-14T08:30:00Z'); // 14:00 IST on the 14th
    expect(classifyOrderDate('2026-10-10', IST, now)).toBe(
      OrderDateType.BACKTRACKED,
    );
    expect(classifyOrderDate('2026-10-14', IST, now)).toBe(
      OrderDateType.CURRENT,
    );
    expect(classifyOrderDate('2026-10-20', IST, now)).toBe(
      OrderDateType.ADVANCE_DATED,
    );
  });

  it('accepts a Date (the UTC-midnight shape Prisma returns) as well as a string', () => {
    const now = new Date('2026-10-13T19:00:00Z');
    expect(classifyOrderDate(d('2026-10-14'), IST, now)).toBe(
      OrderDateType.CURRENT,
    );
  });
});
