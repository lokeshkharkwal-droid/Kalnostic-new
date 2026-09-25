import {
  patientAgeDisplay,
  patientFullAgeDisplay,
  patientSingleUnitAgeDisplay,
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

describe('patientFullAgeDisplay', () => {
  it('breaks the DOB down into Years, Months, Days', () => {
    expect(patientFullAgeDisplay(d('2001-12-12'), 23, 'YEARS', NOW)).toBe(
      '24 Years, 9 Months, 13 Days',
    );
  });

  it("borrows days from the previous month when today's day is earlier", () => {
    expect(patientFullAgeDisplay(d('2026-03-28'), null, null, NOW)).toBe(
      '0 Years, 5 Months, 28 Days',
    );
  });

  it('singularises each component of 1', () => {
    expect(patientFullAgeDisplay(d('2025-08-24'), null, null, NOW)).toBe(
      '1 Year, 1 Month, 1 Day',
    );
  });

  it('falls back to the age/ageType snapshot without a usable DOB', () => {
    expect(patientFullAgeDisplay(null, 30, 'YEARS', NOW)).toBe('30 Years');
    expect(patientFullAgeDisplay(d('2026-10-01'), 6, 'MONTHS', NOW)).toBe(
      '6 Months',
    );
    expect(patientFullAgeDisplay(null, null, null, NOW)).toBe('');
  });
});

describe('patientSingleUnitAgeDisplay', () => {
  const age = (dob: string) =>
    patientSingleUnitAgeDisplay(d(dob), null, null, NOW);

  it('uses Days up to 31 days old', () => {
    expect(age('2026-09-25')).toBe('0 Days');
    expect(age('2026-09-24')).toBe('1 Day');
    expect(age('2026-09-10')).toBe('15 Days');
    expect(age('2026-08-25')).toBe('31 Days');
  });

  it('uses Months from 32 days up to 12 months old', () => {
    expect(age('2026-08-24')).toBe('1 Month');
    expect(age('2026-03-20')).toBe('6 Months');
    // Today's day-of-month is before the DOB's → the month isn't complete yet.
    expect(age('2026-03-28')).toBe('5 Months');
    expect(age('2025-09-25')).toBe('12 Months');
  });

  it('uses Years past 12 months old', () => {
    expect(age('2025-08-25')).toBe('1 Year');
    expect(age('2001-09-25')).toBe('25 Years');
    // The day before the 25th birthday is still 24.
    expect(age('2001-09-26')).toBe('24 Years');
  });

  it('prefers the DOB over a stale age/ageType snapshot', () => {
    expect(patientSingleUnitAgeDisplay(d('2001-12-12'), 23, 'YEARS', NOW)).toBe(
      '24 Years',
    );
  });

  it('falls back to the age/ageType snapshot without a usable DOB', () => {
    expect(patientSingleUnitAgeDisplay(null, 23, 'YEARS', NOW)).toBe(
      '23 Years',
    );
    expect(patientSingleUnitAgeDisplay(d('2026-10-01'), 6, 'MONTHS', NOW)).toBe(
      '6 Months',
    );
    expect(
      patientSingleUnitAgeDisplay(new Date('invalid'), 10, 'DAYS', NOW),
    ).toBe('10 Days');
    expect(patientSingleUnitAgeDisplay(null, null, null, NOW)).toBe('');
  });
});
