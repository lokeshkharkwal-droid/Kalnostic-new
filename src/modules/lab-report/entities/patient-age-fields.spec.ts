import { AgeType } from '@prisma/client';
import { patientAgeFields } from './lab-report.entity';

const dob = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('patientAgeFields (the age on a Technician row)', () => {
  it('a stored age always wins, exactly as before', () => {
    expect(
      patientAgeFields({
        age: 41,
        ageType: AgeType.YEARS,
        dateOfBirth: dob('1985-04-12'),
      }),
    ).toEqual({ age: 41, ageType: 'YEARS', ageDisplay: '41y' });
    expect(
      patientAgeFields({ age: 6, ageType: AgeType.MONTHS, dateOfBirth: null }),
    ).toEqual({ age: 6, ageType: 'MONTHS', ageDisplay: '6mo' });
  });

  it('a stored age of 0 is still a stored age (a newborn is not replaced by the date of birth)', () => {
    expect(
      patientAgeFields({
        age: 0,
        ageType: AgeType.DAYS,
        dateOfBirth: dob('1985-04-12'),
      }),
    ).toEqual({ age: 0, ageType: 'DAYS', ageDisplay: '0d' });
  });

  it('an age with no unit reads as years, as before', () => {
    expect(
      patientAgeFields({ age: 28, ageType: null, dateOfBirth: null }),
    ).toEqual({ age: 28, ageType: null, ageDisplay: '28y' });
  });

  it('no stored age but a date of birth: the age is worked out from it', () => {
    const r = patientAgeFields({
      age: null,
      ageType: null,
      dateOfBirth: dob('1990-05-14'),
    });
    expect(r.age).toBeGreaterThanOrEqual(35);
    expect(r.ageType).toBe('YEARS');
    expect(r.ageDisplay).toBe(`${r.age}y`);
  });

  it('a date-of-birth-only baby reads in months or days, never as years', () => {
    const young = new Date();
    young.setUTCDate(young.getUTCDate() - 10);
    const r = patientAgeFields({
      age: null,
      ageType: null,
      dateOfBirth: young,
    });
    expect(r.ageType).toBe('DAYS');
    expect(r.ageDisplay).toBe(`${r.age}d`);
  });

  it('nothing known stays blank (no invented age)', () => {
    expect(
      patientAgeFields({ age: null, ageType: null, dateOfBirth: null }),
    ).toEqual({ age: null, ageType: null, ageDisplay: null });
  });
});
