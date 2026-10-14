import { AgeUnit } from '@prisma/client';
import {
  addAgeBound,
  ageBoundKey,
  ageRangeKey,
  classifyAgeMatch,
  classifyAgeOverlap,
  formatAgeBound,
  isAgeRangeValid,
  type AgeBound,
} from './age-bounds.util';

const D = AgeUnit.DAYS;
const M = AgeUnit.MONTHS;
const Y = AgeUnit.YEARS;

const b = (value: number, unit: AgeUnit): AgeBound => ({ value, unit });

/** Day number of a calendar date, for asserting `addAgeBound` results. */
const day = (y: number, m: number, d: number): number =>
  Math.round(Date.UTC(y, m - 1, d) / 86_400_000);

describe('isAgeRangeValid', () => {
  describe('accepted ranges', () => {
    it.each([
      ['15 Days .. 1 Year (manager example)', b(15, D), b(1, Y)],
      [
        '1 Year .. 12 Months (same length, To covers its whole unit)',
        b(1, Y),
        b(12, M),
      ],
      ['30 Days .. 1 Month (never empty)', b(30, D), b(1, M)],
      ['1 Month .. 1 Year', b(1, M), b(1, Y)],
      ['1 Month .. 11 Months', b(1, M), b(11, M)],
      ['0 Days .. 28 Days (newborn)', b(0, D), b(28, D)],
      ['0 Days .. 0 Days (single day)', b(0, D), b(0, D)],
      ['1 Year .. 1 Year (single year)', b(1, Y), b(1, Y)],
      ['1 Year .. 2 Years', b(1, Y), b(2, Y)],
      ['0 Years .. 999 Years (open-ended default)', b(0, Y), b(999, Y)],
      ['12 Months .. 1 Year', b(12, M), b(1, Y)],
      ['365 Days .. 1 Year', b(365, D), b(1, Y)],
      ['1 Month .. 31 Days', b(1, M), b(31, D)],
      ['6 Months .. 12 Months', b(6, M), b(12, M)],
      [
        '13 Months .. 1 Year (year 1 covers months 12 to 23)',
        b(13, M),
        b(1, Y),
      ],
    ])('%s', (_label, from, to) => {
      expect(isAgeRangeValid(from, to)).toBe(true);
    });
  });

  describe('rejected ranges', () => {
    it.each([
      ['1 Year .. 11 Months (reversed)', b(1, Y), b(11, M)],
      ['2 Years .. 11 Months (reversed)', b(2, Y), b(11, M)],
      ['5 Years .. 1 Year (reversed, same unit)', b(5, Y), b(1, Y)],
      ['29 Days .. 28 Days (reversed, same unit)', b(29, D), b(28, D)],
      [
        '24 Months .. 1 Year (reversed: 24 months starts after year 1 ends)',
        b(24, M),
        b(1, Y),
      ],
      [
        '1 Month .. 30 Days (empty for a baby born on 1 January)',
        b(1, M),
        b(30, D),
      ],
      [
        '730 Days .. 1 Year (empty for a baby born on 29 February)',
        b(730, D),
        b(1, Y),
      ],
      ['400 Days .. 3 Months (reversed)', b(400, D), b(3, M)],
    ])('%s', (_label, from, to) => {
      expect(isAgeRangeValid(from, to)).toBe(false);
    });
  });

  it('is consistent when called repeatedly (cache)', () => {
    expect(isAgeRangeValid(b(15, D), b(1, Y))).toBe(true);
    expect(isAgeRangeValid(b(15, D), b(1, Y))).toBe(true);
    expect(isAgeRangeValid(b(1, Y), b(11, M))).toBe(false);
    expect(isAgeRangeValid(b(1, Y), b(11, M))).toBe(false);
  });
});

describe('addAgeBound (calendar arithmetic)', () => {
  it('adds days', () => {
    expect(addAgeBound({ y: 2026, m: 10, d: 11 }, b(28, D))).toBe(
      day(2026, 11, 8),
    );
  });

  it('clamps 31 Jan + 1 month to the last day of February', () => {
    expect(addAgeBound({ y: 2026, m: 1, d: 31 }, b(1, M))).toBe(
      day(2026, 2, 28),
    );
    expect(addAgeBound({ y: 2024, m: 1, d: 31 }, b(1, M))).toBe(
      day(2024, 2, 29),
    );
  });

  it('clamps 29 Feb + 1 year to 28 Feb in a non-leap year', () => {
    expect(addAgeBound({ y: 2024, m: 2, d: 29 }, b(1, Y))).toBe(
      day(2025, 2, 28),
    );
    expect(addAgeBound({ y: 2024, m: 2, d: 29 }, b(4, Y))).toBe(
      day(2028, 2, 29),
    );
  });

  it('treats 12 months as exactly 1 year', () => {
    const dob = { y: 2025, m: 10, d: 11 };
    expect(addAgeBound(dob, b(12, M))).toBe(addAgeBound(dob, b(1, Y)));
    expect(addAgeBound(dob, b(1, Y))).toBe(day(2026, 10, 11));
  });

  it('rolls months across a year end', () => {
    expect(addAgeBound({ y: 2025, m: 11, d: 15 }, b(3, M))).toBe(
      day(2026, 2, 15),
    );
  });

  it('handles a day-of-month that exists in the target month', () => {
    expect(addAgeBound({ y: 2026, m: 3, d: 31 }, b(1, M))).toBe(
      day(2026, 4, 30),
    );
  });
});

describe('formatAgeBound', () => {
  it('singularises a value of 1 and pluralises the rest', () => {
    expect(formatAgeBound(b(1, Y))).toBe('1 Year');
    expect(formatAgeBound(b(15, D))).toBe('15 Days');
    expect(formatAgeBound(b(0, M))).toBe('0 Months');
    expect(formatAgeBound(b(1, D))).toBe('1 Day');
  });
});

/**
 * The database CHECK (migration 20261011120000_age_range_unit_aware_check) is a
 * conservative safety net: it must NEVER reject a range this application accepts.
 * Mirrors the SQL: lowest length of From (day 1, month 28, year 365) < highest
 * length of To + 1 unit (day 1, month 31, year 366).
 */
describe('database safety-net CHECK vs the exact rule', () => {
  const lowest: Record<AgeUnit, number> = { DAYS: 1, MONTHS: 28, YEARS: 365 };
  const highest: Record<AgeUnit, number> = { DAYS: 1, MONTHS: 31, YEARS: 366 };
  const dbCheckAccepts = (from: AgeBound, to: AgeBound): boolean =>
    from.value * lowest[from.unit] < (to.value + 1) * highest[to.unit];

  const values = [
    0, 1, 2, 3, 6, 11, 12, 13, 24, 28, 29, 30, 31, 59, 60, 365, 366, 730, 999,
  ];
  const units = [D, M, Y];

  it('accepts every range the application accepts (checked over a wide grid)', () => {
    const wronglyRejected: string[] = [];
    for (const fu of units) {
      for (const tu of units) {
        for (const fv of values) {
          for (const tv of values) {
            const from = b(fv, fu);
            const to = b(tv, tu);
            if (isAgeRangeValid(from, to) && !dbCheckAccepts(from, to)) {
              wronglyRejected.push(
                `${formatAgeBound(from)} .. ${formatAgeBound(to)}`,
              );
            }
          }
        }
      }
    }
    expect(wronglyRejected).toEqual([]);
  });

  it('still rejects clearly reversed ranges', () => {
    expect(dbCheckAccepts(b(5, Y), b(1, Y))).toBe(false);
    expect(dbCheckAccepts(b(2, Y), b(11, M))).toBe(false);
    expect(dbCheckAccepts(b(29, D), b(28, D))).toBe(false);
  });
});

describe('ageBoundKey / ageRangeKey (same key = same ages for every birth date)', () => {
  it('treats 12 months as exactly 1 year ("To" covers its whole unit, so 1 Year..1 Year is 12..23 Months)', () => {
    expect(ageBoundKey(b(12, M))).toBe(ageBoundKey(b(1, Y)));
    expect(ageRangeKey(b(12, M), b(23, M))).toBe(ageRangeKey(b(1, Y), b(1, Y)));
    expect(ageRangeKey(b(12, M), b(24, M))).not.toBe(
      ageRangeKey(b(1, Y), b(2, Y)),
    );
  });

  it('treats a zero bound as the birth date whatever its unit', () => {
    expect(ageBoundKey(b(0, D))).toBe(ageBoundKey(b(0, Y)));
    expect(ageRangeKey(b(0, D), b(1, Y))).toBe(ageRangeKey(b(0, Y), b(1, Y)));
  });

  it('does not equate days with months or years (a month / year is not a fixed number of days)', () => {
    expect(ageBoundKey(b(30, D))).not.toBe(ageBoundKey(b(1, M)));
    expect(ageBoundKey(b(365, D))).not.toBe(ageBoundKey(b(1, Y)));
    expect(ageRangeKey(b(1, Y), b(2, Y))).not.toBe(
      ageRangeKey(b(365, D), b(2, Y)),
    );
  });

  it('keeps genuinely different ranges apart', () => {
    expect(ageRangeKey(b(0, Y), b(17, Y))).not.toBe(
      ageRangeKey(b(18, Y), b(60, Y)),
    );
    expect(ageRangeKey(b(1, Y), b(1, Y))).not.toBe(
      ageRangeKey(b(1, Y), b(2, Y)),
    );
  });
});

describe('classifyAgeOverlap', () => {
  const cls = (aF: AgeBound, aT: AgeBound, bF: AgeBound, bT: AgeBound) =>
    classifyAgeOverlap(aF, aT, bF, bT);

  describe('definite overlaps (rejected by the overlap check)', () => {
    it.each([
      ['0-28 Days and 20 Days-3 Months', b(0, D), b(28, D), b(20, D), b(3, M)],
      ['0-3 Months and 1-11 Months', b(0, M), b(3, M), b(1, M), b(11, M)],
      [
        '1-5 Years and 5-10 Years ("To 5 Years" covers the whole fifth year)',
        b(1, Y),
        b(5, Y),
        b(5, Y),
        b(10, Y),
      ],
      ['the same range twice', b(1, Y), b(5, Y), b(1, Y), b(5, Y)],
      [
        '0-12 Months and 1 Year-5 Years (12 months is exactly 1 year)',
        b(0, M),
        b(12, M),
        b(1, Y),
        b(5, Y),
      ],
      [
        '0-31 Days and 1-11 Months (every month is at most 31 days)',
        b(0, D),
        b(31, D),
        b(1, M),
        b(11, M),
      ],
      ['one range inside another', b(0, Y), b(999, Y), b(18, Y), b(60, Y)],
    ])('%s', (_label, aF, aT, bF, bT) => {
      expect(cls(aF, aT, bF, bT)).toBe('definite');
      expect(cls(bF, bT, aF, aT)).toBe('definite'); // symmetric
    });
  });

  describe('possible overlaps: a calendar edge for some birth dates only (allowed)', () => {
    it.each([
      [
        '0-28 Days and 1-11 Months (day 28 for a baby born in February)',
        b(0, D),
        b(28, D),
        b(1, M),
        b(11, M),
      ],
      ['0-29 Days and 1-11 Months', b(0, D), b(29, D), b(1, M), b(11, M)],
      [
        '0-30 Days and 1-11 Months (day 30 when the month has 30 days or fewer)',
        b(0, D),
        b(30, D),
        b(1, M),
        b(11, M),
      ],
      [
        '0-365 Days and 1 Year-5 Years (a leap year is 366 days)',
        b(0, D),
        b(365, D),
        b(1, Y),
        b(5, Y),
      ],
    ])('%s', (_label, aF, aT, bF, bT) => {
      expect(cls(aF, aT, bF, bT)).toBe('possible');
      expect(cls(bF, bT, aF, aT)).toBe('possible');
    });
  });

  describe('no overlap', () => {
    it.each([
      [
        '1-4 Years and 5-10 Years (meet at the fifth birthday)',
        b(1, Y),
        b(4, Y),
        b(5, Y),
        b(10, Y),
      ],
      ['0-28 Days and 1 Year-5 Years', b(0, D), b(28, D), b(1, Y), b(5, Y)],
      ['0-11 Months and 1-5 Years', b(0, M), b(11, M), b(1, Y), b(5, Y)],
      ['0-17 Years and 18-60 Years', b(0, Y), b(17, Y), b(18, Y), b(60, Y)],
      ['0-27 Days and 1-11 Months', b(0, D), b(27, D), b(1, M), b(11, M)],
    ])('%s', (_label, aF, aT, bF, bT) => {
      expect(cls(aF, aT, bF, bT)).toBe('none');
      expect(cls(bF, bT, aF, aT)).toBe('none');
    });
  });
});

describe('classifyAgeMatch (the stored age of a patient against a range)', () => {
  const m = (age: AgeBound, from: AgeBound, to: AgeBound) =>
    classifyAgeMatch(age, from, to);

  it.each([
    ['34 Years in 18-60 Years', b(34, Y), b(18, Y), b(60, Y)],
    [
      '60 Years in 18-60 Years (the last year of the band)',
      b(60, Y),
      b(18, Y),
      b(60, Y),
    ],
    ['0 Days in 0-28 Days (a newborn)', b(0, D), b(0, D), b(28, D)],
    ['28 Days in 0-28 Days', b(28, D), b(0, D), b(28, D)],
    ['6 Months in 1-11 Months', b(6, M), b(1, M), b(11, M)],
    ['11 Months in 1-11 Months', b(11, M), b(1, M), b(11, M)],
    [
      '12 Months in 1 Year-1 Year (12 months is exactly 1 year)',
      b(12, M),
      b(1, Y),
      b(1, Y),
    ],
    ['1 Year in 12-23 Months', b(1, Y), b(12, M), b(23, M)],
    ['18 Months in 1-2 Years', b(18, M), b(1, Y), b(2, Y)],
    ['40 Years in 0-999 Years (open ended)', b(40, Y), b(0, Y), b(999, Y)],
  ])('match: %s', (_l, age, from, to) => {
    expect(m(age, from, to)).toBe('match');
  });

  it.each([
    ['29 Days is past 0-28 Days', b(29, D), b(0, D), b(28, D)],
    ['12 Months is not in 1-11 Months', b(12, M), b(1, M), b(11, M)],
    ['17 Years is not in 18-60 Years', b(17, Y), b(18, Y), b(60, Y)],
    ['5 Years is not in 1-4 Years', b(5, Y), b(1, Y), b(4, Y)],
    ['6 Months is not in 0-28 Days', b(6, M), b(0, D), b(28, D)],
  ])('none: %s', (_l, age, from, to) => {
    expect(m(age, from, to)).toBe('none');
  });

  it.each([
    [
      '1 Year against 0-17 Months (a stored year cannot say which month)',
      b(1, Y),
      b(0, M),
      b(17, M),
    ],
    ['1 Year against 18-23 Months', b(1, Y), b(18, M), b(23, M)],
    [
      '30 Days against 1-11 Months (a month is 28 to 31 days)',
      b(30, D),
      b(1, M),
      b(11, M),
    ],
    [
      '28 Days against 1-11 Months (a month for a baby born in February)',
      b(28, D),
      b(1, M),
      b(11, M),
    ],
    ['2 Months against 1-60 Days', b(2, M), b(1, D), b(60, D)],
  ])('partial: %s', (_l, age, from, to) => {
    expect(m(age, from, to)).toBe('partial');
  });

  it('an age of 0 is a real age', () => {
    expect(m(b(0, Y), b(0, Y), b(17, Y))).toBe('match');
    expect(m(b(0, Y), b(18, Y), b(60, Y))).toBe('none');
  });

  it('adjacent bands never both match one stored age', () => {
    for (const age of [
      b(0, D),
      b(28, D),
      b(29, D),
      b(1, M),
      b(11, M),
      b(12, M),
      b(1, Y),
      b(4, Y),
      b(5, Y),
      b(60, Y),
    ]) {
      const first = m(age, b(0, D), b(28, D));
      const second = m(age, b(1, M), b(11, M));
      const third = m(age, b(1, Y), b(4, Y));
      expect(
        [first, second, third].filter((x) => x === 'match').length,
      ).toBeLessThanOrEqual(1);
    }
  });

  /**
   * Cross-check against an independent calculation: for random birth dates and
   * dates, take the real completed age in the stored unit, and check the verdict
   * agrees with whether the date really lies in the range for THAT birth date.
   */
  describe('agrees with a real birth date / date calculation (randomised)', () => {
    const DAY = 86_400_000;
    const lastDay = (y: number, mIdx: number) =>
      new Date(Date.UTC(y, mIdx + 1, 0)).getUTCDate();
    const addMonthsClamp = (dob: number, k: number): number => {
      const d = new Date(dob);
      const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() + k;
      const y = Math.floor(idx / 12);
      const mIdx = idx % 12;
      return Date.UTC(y, mIdx, Math.min(d.getUTCDate(), lastDay(y, mIdx)));
    };
    const add = (dob: number, bound: AgeBound): number =>
      bound.unit === AgeUnit.DAYS
        ? dob + bound.value * DAY
        : addMonthsClamp(
            dob,
            bound.unit === AgeUnit.YEARS ? bound.value * 12 : bound.value,
          );
    /** The real completed age in a unit: the largest k whose date has already been reached. */
    const completed = (dob: number, date: number, unit: AgeUnit): number => {
      let k = 0;
      while (add(dob, b(k + 1, unit)) <= date) k++;
      return k;
    };

    let seed = 20261013;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;

    it('match => the date is inside the range; none => it is not (6000 random cases)', () => {
      const ranges: [AgeBound, AgeBound][] = [
        [b(0, D), b(28, D)],
        [b(1, M), b(11, M)],
        [b(1, Y), b(4, Y)],
        [b(5, Y), b(17, Y)],
        [b(18, Y), b(60, Y)],
        [b(12, M), b(23, M)],
        [b(0, M), b(17, M)],
        [b(18, M), b(23, M)],
        [b(1, D), b(60, D)],
        [b(0, Y), b(999, Y)],
      ];
      const start = Date.UTC(2024, 0, 1);
      let matches = 0;
      let nones = 0;
      for (let i = 0; i < 6000; i++) {
        const dob = start + Math.floor(rand() * 1461) * DAY;
        const date = dob + Math.floor(rand() * 1100) * DAY;
        const unit = pick([AgeUnit.DAYS, AgeUnit.MONTHS, AgeUnit.YEARS]);
        const age = b(completed(dob, date, unit), unit);
        const [from, to] = pick(ranges);
        const inRange =
          date >= add(dob, from) &&
          date < add(dob, { value: to.value + 1, unit: to.unit });
        const verdict = classifyAgeMatch(age, from, to);
        if (verdict === 'match') {
          matches++;
          expect(inRange).toBe(true);
        }
        if (verdict === 'none') {
          nones++;
          expect(inRange).toBe(false);
        }
      }
      expect(matches).toBeGreaterThan(300);
      expect(nones).toBeGreaterThan(300);
    });
  });
});
