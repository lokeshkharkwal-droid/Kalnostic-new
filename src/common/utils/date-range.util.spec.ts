import { timestampRange } from './date-range.util';

/**
 * The list screens send plain days (`2026-10-06`). For a timestamp column the end
 * day must be included in full — a single-day range used to match nothing
 * because `lte 2026-10-06` meant "up to 00:00 UTC on the 6th".
 */
describe('timestampRange', () => {
  it('returns nothing when no date is given', () => {
    expect(timestampRange()).toBeUndefined();
    expect(timestampRange('', '')).toBeUndefined();
  });

  it('a single day covers that whole day', () => {
    expect(timestampRange('2026-10-06', '2026-10-06')).toEqual({
      gte: new Date('2026-10-06T00:00:00.000Z'),
      lt: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('a range includes the whole end day', () => {
    const r = timestampRange('2026-10-05', '2026-10-06')!;
    expect(r.gte).toEqual(new Date('2026-10-05T00:00:00.000Z'));
    expect(r.lt).toEqual(new Date('2026-10-07T00:00:00.000Z'));
    // a record created late on the end day is inside the range
    const lateOnEndDay = new Date('2026-10-06T23:59:59.999Z');
    expect(lateOnEndDay < r.lt!).toBe(true);
    // the next day's first instant is not
    expect(new Date('2026-10-07T00:00:00.000Z') < r.lt!).toBe(false);
  });

  it('the start day is included from its first instant', () => {
    const r = timestampRange('2026-10-05', '2026-10-06')!;
    expect(new Date('2026-10-05T00:00:00.000Z') >= r.gte!).toBe(true);
    expect(new Date('2026-10-04T23:59:59.999Z') >= r.gte!).toBe(false);
  });

  it('only a start date leaves the end open', () => {
    expect(timestampRange('2026-10-07')).toEqual({
      gte: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('only an end date leaves the start open and still covers the whole end day', () => {
    expect(timestampRange(undefined, '2026-10-06')).toEqual({
      lt: new Date('2026-10-07T00:00:00.000Z'),
    });
  });

  it('rolls over month and year ends', () => {
    expect(timestampRange('2026-12-31', '2026-12-31')!.lt).toEqual(
      new Date('2027-01-01T00:00:00.000Z'),
    );
    expect(timestampRange('2026-02-28', '2026-02-28')!.lt).toEqual(
      new Date('2026-03-01T00:00:00.000Z'),
    );
    expect(timestampRange('2028-02-28', '2028-02-29')!.lt).toEqual(
      new Date('2028-03-01T00:00:00.000Z'),
    );
  });

  it('an end value that already carries a time is kept as the exact inclusive bound', () => {
    expect(timestampRange('2026-10-05', '2026-10-06T10:30:00.000Z')).toEqual({
      gte: new Date('2026-10-05T00:00:00.000Z'),
      lte: new Date('2026-10-06T10:30:00.000Z'),
    });
  });

  it('never produces both an exclusive and an inclusive end', () => {
    const r = timestampRange('2026-10-05', '2026-10-06')!;
    expect(r.lte).toBeUndefined();
    const t = timestampRange('2026-10-05', '2026-10-06T10:30:00Z')!;
    expect(t.lt).toBeUndefined();
  });
});
