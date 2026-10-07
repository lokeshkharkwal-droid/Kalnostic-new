import {
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
