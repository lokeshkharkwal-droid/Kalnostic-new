import { AgeType, AgeUnit } from '@prisma/client';
import {
  calendarDayIn,
  completedAge,
  dobFromAge,
  dobInAgeBand,
  exactBirthDate,
} from './age-dob.util';

const day = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d));
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('calendarDayIn', () => {
  it('reads the branch calendar day, not the UTC day', () => {
    // 20:00 UTC on 12 Oct is already 01:30 on 13 Oct in India.
    const instant = new Date('2026-10-12T20:00:00Z');
    expect(iso(calendarDayIn(instant, 'Asia/Kolkata'))).toBe('2026-10-13');
    expect(iso(calendarDayIn(instant, 'UTC'))).toBe('2026-10-12');
    expect(iso(calendarDayIn(instant, null))).toBe('2026-10-12');
  });

  it('falls back to the UTC day for an unknown zone name', () => {
    expect(
      iso(calendarDayIn(new Date('2026-10-12T20:00:00Z'), 'Not/AZone')),
    ).toBe('2026-10-12');
  });
});

describe('dobFromAge — the date of birth an age implies, subtracted exactly', () => {
  it('years: the same date that many years ago', () => {
    expect(iso(dobFromAge(20, AgeType.YEARS, day(2026, 10, 13)))).toBe(
      '2006-10-13',
    );
    expect(iso(dobFromAge(34, null, day(2026, 10, 13)))).toBe('1992-10-13'); // unset unit = years
  });

  it('months: that many calendar months back, month-end clamped', () => {
    expect(iso(dobFromAge(3, AgeType.MONTHS, day(2026, 10, 13)))).toBe(
      '2026-07-13',
    );
    expect(iso(dobFromAge(1, AgeType.MONTHS, day(2026, 3, 31)))).toBe(
      '2026-02-28',
    ); // not 3 March
    expect(iso(dobFromAge(1, AgeType.MONTHS, day(2028, 3, 31)))).toBe(
      '2028-02-29',
    );
    expect(iso(dobFromAge(14, AgeType.MONTHS, day(2026, 1, 31)))).toBe(
      '2024-11-30',
    );
  });

  it('days: that many days back, across month and year ends', () => {
    expect(iso(dobFromAge(30, AgeType.DAYS, day(2026, 10, 13)))).toBe(
      '2026-09-13',
    );
    expect(iso(dobFromAge(15, AgeType.DAYS, day(2026, 1, 5)))).toBe(
      '2025-12-21',
    );
  });

  it('years: 29 Feb lands on 28 Feb in a non-leap year', () => {
    expect(iso(dobFromAge(1, AgeType.YEARS, day(2028, 2, 29)))).toBe(
      '2027-02-28',
    );
  });

  it('age 0 is a real age (born today)', () => {
    expect(iso(dobFromAge(0, AgeType.DAYS, day(2026, 10, 13)))).toBe(
      '2026-10-13',
    );
    expect(iso(dobFromAge(0, AgeType.YEARS, day(2026, 10, 13)))).toBe(
      '2026-10-13',
    );
  });

  it('gives nothing for a missing, negative, fractional or impossible age', () => {
    const d = day(2026, 10, 13);
    expect(dobFromAge(null, AgeType.YEARS, d)).toBeNull();
    expect(dobFromAge(undefined, AgeType.YEARS, d)).toBeNull();
    expect(dobFromAge(-1, AgeType.YEARS, d)).toBeNull();
    expect(dobFromAge(1.5, AgeType.YEARS, d)).toBeNull();
    expect(dobFromAge(151, AgeType.YEARS, d)).toBeNull();
    expect(dobFromAge(2147483647, AgeType.DAYS, d)).toBeNull();
  });
});

describe('completedAge', () => {
  it('counts completed days, months and years', () => {
    expect(completedAge(day(1992, 10, 13), day(2026, 10, 13))).toEqual({
      days: 12418,
      months: 408,
      years: 34,
    });
    expect(completedAge(day(1992, 10, 13), day(2026, 10, 12))?.years).toBe(33);
  });

  it('a month completes on the last day when the birth day does not exist in it', () => {
    expect(completedAge(day(2026, 1, 31), day(2026, 2, 28))?.months).toBe(1);
    expect(completedAge(day(2026, 1, 31), day(2026, 2, 27))?.months).toBe(0);
  });

  it('is null before the birth date', () => {
    expect(completedAge(day(2026, 10, 14), day(2026, 10, 13))).toBeNull();
  });

  it('agrees with a plain "add whole months until it overshoots" count (random dates)', () => {
    const addMonths = (dob: Date, k: number): Date => {
      const total = dob.getUTCFullYear() * 12 + dob.getUTCMonth() + k;
      const y = Math.floor(total / 12);
      const m = total % 12;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return new Date(Date.UTC(y, m, Math.min(dob.getUTCDate(), last)));
    };
    let seed = 12345;
    const rnd = () =>
      (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 20000; i++) {
      const dob = new Date(
        Date.UTC(
          1900 + Math.floor(rnd() * 130),
          Math.floor(rnd() * 12),
          1 + Math.floor(rnd() * 31),
        ),
      );
      if (Number.isNaN(dob.getTime())) continue;
      const on = new Date(
        dob.getTime() + Math.floor(rnd() * 40000) * 86_400_000,
      );
      let k = 0;
      while (addMonths(dob, k + 1).getTime() <= on.getTime()) k++;
      expect(completedAge(dob, on)?.months).toBe(k);
    }
  });
});

describe('an age typed and then measured on the same day comes back unchanged', () => {
  it('round-trips for every unit on every day of two years (leap year included)', () => {
    const units: [AgeType, 'years' | 'months' | 'days'][] = [
      [AgeType.YEARS, 'years'],
      [AgeType.MONTHS, 'months'],
      [AgeType.DAYS, 'days'],
    ];
    for (let offset = 0; offset < 731; offset++) {
      const on = new Date(Date.UTC(2027, 0, 1 + offset));
      for (const age of [0, 1, 2, 11, 12, 29, 30, 31, 100]) {
        for (const [type, field] of units) {
          const dob = dobFromAge(age, type, on);
          expect(dob).not.toBeNull();
          expect(completedAge(dob!, on)![field]).toBe(age);
        }
      }
    }
  });
});

describe('dobInAgeBand — the calendar decides, nothing is "partial"', () => {
  const band = (
    from: number,
    fromUnit: AgeUnit,
    to: number,
    toUnit: AgeUnit,
  ) => ({
    ageFrom: from,
    ageFromUnit: fromUnit,
    ageTo: to,
    ageToUnit: toUnit,
  });
  const on = day(2026, 10, 13);

  it('"To" covers its whole unit: 17 years and 364 days is inside 0-17 Years', () => {
    expect(
      dobInAgeBand(
        day(2008, 10, 14),
        on,
        band(0, AgeUnit.YEARS, 17, AgeUnit.YEARS),
      ),
    ).toBe(true); // 17y 364d
    expect(
      dobInAgeBand(
        day(2008, 10, 13),
        on,
        band(0, AgeUnit.YEARS, 17, AgeUnit.YEARS),
      ),
    ).toBe(false); // 18y 0d
  });

  it('settles the old calendar-edge cases exactly: 30 days against 0-30 Days and 1-11 Months', () => {
    const born = day(2026, 9, 13); // exactly 30 days old on 13 Oct
    expect(
      dobInAgeBand(born, on, band(0, AgeUnit.DAYS, 30, AgeUnit.DAYS)),
    ).toBe(true);
    expect(
      dobInAgeBand(born, on, band(1, AgeUnit.MONTHS, 11, AgeUnit.MONTHS)),
    ).toBe(true); // a full calendar month on this date
    const winter = day(2026, 1, 14);
    expect(
      dobInAgeBand(
        winter,
        day(2026, 2, 13),
        band(1, AgeUnit.MONTHS, 11, AgeUnit.MONTHS),
      ),
    ).toBe(false); // 30 days but not a month yet
  });

  it('is null (undecided) when the birth date is after the day asked about', () => {
    expect(
      dobInAgeBand(
        day(2026, 10, 14),
        on,
        band(0, AgeUnit.YEARS, 999, AgeUnit.YEARS),
      ),
    ).toBeNull();
  });
});

describe('exactBirthDate — which birth date to age a patient by', () => {
  const on = day(2026, 10, 13);
  const created = new Date('2024-10-13T05:00:00Z'); // 10:30 IST on 13 Oct 2024

  it('a real date of birth wins over the saved age', () => {
    expect(
      iso(
        exactBirthDate(
          {
            dateOfBirth: day(1990, 5, 5),
            age: 30,
            ageType: AgeType.YEARS,
            createdAt: created,
          },
          on,
          'Asia/Kolkata',
        ),
      ),
    ).toBe('1990-05-05');
  });

  it('age only: the day the record was created minus the age (so it is right years later)', () => {
    // told "30 years" on 13 Oct 2024 -> born 13 Oct 1994 -> 32 on 13 Oct 2026
    const dob = exactBirthDate(
      { age: 30, ageType: AgeType.YEARS, createdAt: created },
      on,
      'Asia/Kolkata',
    );
    expect(iso(dob)).toBe('1994-10-13');
    expect(completedAge(dob!, on)?.years).toBe(32);
  });

  it('uses the branch day of creation, not the UTC day', () => {
    const lateEvening = new Date('2024-10-12T20:00:00Z'); // 01:30 IST on 13 Oct
    expect(
      iso(
        exactBirthDate(
          { age: 30, ageType: AgeType.YEARS, createdAt: lateEvening },
          on,
          'Asia/Kolkata',
        ),
      ),
    ).toBe('1994-10-13');
    expect(
      iso(
        exactBirthDate(
          { age: 30, ageType: AgeType.YEARS, createdAt: lateEvening },
          on,
          'UTC',
        ),
      ),
    ).toBe('1994-10-12');
  });

  it('a baby: 30 days told 100 days ago is 130 days old now', () => {
    const told = new Date('2026-07-05T06:00:00Z');
    const dob = exactBirthDate(
      { age: 30, ageType: AgeType.DAYS, createdAt: told },
      on,
      'Asia/Kolkata',
    );
    expect(completedAge(dob!, on)?.days).toBe(130);
  });

  it('ignores a date of birth that is after the day asked about, and falls back to the age', () => {
    const dob = exactBirthDate(
      {
        dateOfBirth: day(2027, 1, 1),
        age: 30,
        ageType: AgeType.YEARS,
        createdAt: created,
      },
      on,
      'UTC',
    );
    expect(iso(dob)).toBe('1994-10-13');
  });

  it('nothing to go on: no date of birth and no age, or an age with no creation date', () => {
    expect(exactBirthDate({}, on, 'UTC')).toBeNull();
    expect(
      exactBirthDate({ age: 30, ageType: AgeType.YEARS }, on, 'UTC'),
    ).toBeNull();
  });
});
