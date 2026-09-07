import { patientAgeDisplay } from './patient-label.util';
import { salutationLabel } from './salutation-label.util';

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
