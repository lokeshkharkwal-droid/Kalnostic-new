import {
  patientAgeDisplay,
  patientPrintAgeDisplay,
  salutationLabel,
} from './patient-label.util';

describe('salutationLabel', () => {
  it('maps each salutation enum to a properly-cased label', () => {
    expect(salutationLabel('MR')).toBe('Mr.');
    expect(salutationLabel('MRS')).toBe('Mrs.');
    expect(salutationLabel('MS')).toBe('Ms.');
    expect(salutationLabel('DR')).toBe('Dr.');
    expect(salutationLabel('PROF')).toBe('Prof.');
  });

  it('returns empty string when unset', () => {
    expect(salutationLabel(null)).toBe('');
    expect(salutationLabel(undefined)).toBe('');
  });
});

describe('patientAgeDisplay', () => {
  it('appends the unit based on ageType, pluralising when not 1', () => {
    expect(patientAgeDisplay(45, 'YEARS')).toBe('45 Years');
    expect(patientAgeDisplay(1, 'YEARS')).toBe('1 Year');
    expect(patientAgeDisplay(6, 'MONTHS')).toBe('6 Months');
    expect(patientAgeDisplay(1, 'MONTHS')).toBe('1 Month');
    expect(patientAgeDisplay(10, 'DAYS')).toBe('10 Days');
    expect(patientAgeDisplay(1, 'DAYS')).toBe('1 Day');
  });

  it('defaults to Years when ageType is unset', () => {
    expect(patientAgeDisplay(30, null)).toBe('30 Years');
    expect(patientAgeDisplay(30, undefined)).toBe('30 Years');
  });

  it('returns empty string when age is unset (no bare unit)', () => {
    expect(patientAgeDisplay(null, 'YEARS')).toBe('');
    expect(patientAgeDisplay(undefined, 'YEARS')).toBe('');
  });

  it('handles age 0 (renders with unit, not blank)', () => {
    expect(patientAgeDisplay(0, 'DAYS')).toBe('0 Days');
  });
});

/** UTC-midnight date, the shape Prisma returns for a `@db.Date` column. */
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const NOW = d('2026-09-25');

describe('patientPrintAgeDisplay', () => {
  const age = (dob: string, now = NOW) =>
    patientPrintAgeDisplay(d(dob), null, null, now);

  it('shows the single leading unit — Years from 12 months old', () => {
    // 25 years 4 months 10 days → 25 Years
    expect(age('2001-05-15')).toBe('25 Years');
    // 1 year 2 months 5 days → 1 Year (singular)
    expect(age('2025-07-20')).toBe('1 Year');
    // The day before the 25th birthday is still 24.
    expect(age('2001-09-26')).toBe('24 Years');
    expect(age('1930-01-01')).toBe('96 Years');
  });

  it('shows Months for 1 to 11 completed months', () => {
    // 11 months 20 days → 11 Months
    expect(age('2025-10-05')).toBe('11 Months');
    // 6 months 15 days → 6 Months
    expect(age('2026-03-10')).toBe('6 Months');
    // 1 month 15 days → 1 Month (singular)
    expect(age('2026-08-10')).toBe('1 Month');
  });

  it('shows Days for under one completed month', () => {
    // 20 days → 20 Days
    expect(age('2026-09-05')).toBe('20 Days');
    // 5 days → 5 Days
    expect(age('2026-09-20')).toBe('5 Days');
    expect(age('2026-09-24')).toBe('1 Day'); // singular
    expect(age('2026-09-25')).toBe('0 Days'); // newborn
  });

  it('treats exactly 12 months as 1 Year', () => {
    expect(age('2025-09-25')).toBe('1 Year');
  });

  it('is calendar-exact on the month/day boundary', () => {
    // 30 calendar days but not yet a full month (Aug has 31) → Days.
    expect(age('2026-08-26')).toBe('30 Days');
    // Exactly one completed calendar month → Months.
    expect(age('2026-08-25')).toBe('1 Month');
    // 11 months 30 days is still under 1 year.
    expect(age('2025-09-26')).toBe('11 Months');
  });

  it('never combines units', () => {
    for (const dob of ['2026-09-10', '2026-03-12', '2001-05-17']) {
      expect(age(dob)).toMatch(/^\d+ (Days?|Months?|Years?)$/);
    }
  });

  it('prefers the DOB over a stale age/ageType snapshot', () => {
    expect(patientPrintAgeDisplay(d('2026-03-25'), 23, 'YEARS', NOW)).toBe(
      '6 Months',
    );
  });

  it('falls back to the age/ageType snapshot without a usable DOB', () => {
    expect(patientPrintAgeDisplay(null, 23, 'YEARS', NOW)).toBe('23 Years');
    expect(patientPrintAgeDisplay(d('2026-10-01'), 6, 'MONTHS', NOW)).toBe(
      '6 Months',
    );
    expect(patientPrintAgeDisplay(new Date('invalid'), 10, 'DAYS', NOW)).toBe(
      '10 Days',
    );
    expect(patientPrintAgeDisplay(null, null, null, NOW)).toBe('');
  });
});
