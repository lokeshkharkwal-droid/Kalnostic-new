import { AgeType, AgeUnit } from '@prisma/client';
import { dobFromAge, exactBirthDate } from './age-dob.util';
import { patientPrintAgeDisplay } from './patient-label.util';
import {
  isExactAgeMatch,
  rangeAgeMatch,
} from '../../modules/lab-report/utils/reference-range.util';

/**
 * A saved patient's age is edited (35 -> 45). Everything that prints or uses the age reads the DATE OF BIRTH first and the stored
 * age only when there is no date of birth. Every print template — the sample barcode label, the bill / order slip / TRF, and the
 * lab report — now shares ONE age rule (`patientPrintAgeDisplay`: Years at ≥12 months, Months at 1–11 months, Days under a month),
 * and the technician's reference range reads the same date of birth (`exactBirthDate` + the age bands). So the age and the date of
 * birth the form saves must AGREE. The first test shows what a stale date of birth does (the reported bug); the rest show that a
 * re-made date of birth makes every one of them read 45.
 */
describe('patient age is consistent everywhere once the date of birth follows the edited age', () => {
  const TODAY = new Date(Date.UTC(2026, 9, 14, 12, 0, 0)); // 14 Oct 2026
  const ON_DAY = new Date(Date.UTC(2026, 9, 14));
  const utcDate = (y: number, m: number, d: number) =>
    new Date(Date.UTC(y, m - 1, d));
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  // Every print template resolves `{patient_age}` through the one shared rule,
  // so the bill, TRF, sample label and lab report all read identically.
  const printAge = (
    dob: Date | null,
    age: number | null,
    ageType: AgeType | null,
  ) => patientPrintAgeDisplay(dob, age, ageType, TODAY);

  it('THE REPORTED BUG: age 45 stored next to the OLD date of birth (35 years ago) prints 35 everywhere', () => {
    expect(printAge(utcDate(1991, 10, 14), 45, AgeType.YEARS)).toBe('35 Years');
  });

  it('age 45 with the date of birth re-made from it prints 45 everywhere', () => {
    const dob = dobFromAge(45, AgeType.YEARS, ON_DAY)!;
    expect(ymd(dob)).toBe('1981-10-14');
    expect(printAge(dob, 45, AgeType.YEARS)).toBe('45 Years');
  });

  it('every age from 2 to 150 years reads back unchanged as a single Years value', () => {
    for (let age = 2; age <= 150; age++) {
      const dob = dobFromAge(age, AgeType.YEARS, ON_DAY)!;
      expect(printAge(dob, age, AgeType.YEARS)).toBe(`${age} Years`);
    }
  });

  it('months and days read back in their own unit', () => {
    const threeMonths = dobFromAge(3, AgeType.MONTHS, ON_DAY)!;
    expect(printAge(threeMonths, 3, AgeType.MONTHS)).toBe('3 Months');
    const twentyDays = dobFromAge(20, AgeType.DAYS, ON_DAY)!;
    expect(printAge(twentyDays, 20, AgeType.DAYS)).toBe('20 Days');
  });

  it('a patient with no date of birth still prints the stored age (nothing to disagree with)', () => {
    expect(printAge(null, 45, AgeType.YEARS)).toBe('45 Years');
  });

  describe('the technician side uses the same date of birth', () => {
    const band = (fromY: number, toY: number) => ({
      ageFrom: fromY,
      ageFromUnit: AgeUnit.YEARS,
      ageTo: toY,
      ageToUnit: AgeUnit.YEARS,
    });
    const child = band(0, 40);
    const adult = band(41, 100);
    const pick = (dob: Date) => {
      const exact = { dob, onDay: ON_DAY };
      const patient = { age: 45, ageType: AgeType.YEARS };
      return {
        child: isExactAgeMatch(rangeAgeMatch(patient, child, exact)),
        adult: isExactAgeMatch(rangeAgeMatch(patient, adult, exact)),
      };
    };

    it('the saved date of birth is the birth date used (a stored age does not override it)', () => {
      const dob = utcDate(1981, 10, 14);
      expect(
        exactBirthDate(
          {
            dateOfBirth: dob,
            age: 35,
            ageType: AgeType.YEARS,
            createdAt: utcDate(2026, 10, 14),
          },
          ON_DAY,
          'Asia/Kolkata',
        ),
      ).toEqual(dob);
    });

    it('a stale date of birth gets the 0-40 range (wrong for a 45-year-old); the re-made one gets 41-100', () => {
      expect(pick(utcDate(1991, 10, 14))).toEqual({
        child: true,
        adult: false,
      });
      expect(pick(dobFromAge(45, AgeType.YEARS, ON_DAY)!)).toEqual({
        child: false,
        adult: true,
      });
    });

    it('a patient who only ever gave an age: the birth date is the creation day minus the age', () => {
      const created = new Date(Date.UTC(2024, 9, 14, 5, 0, 0));
      const dob = exactBirthDate(
        {
          dateOfBirth: null,
          age: 30,
          ageType: AgeType.YEARS,
          createdAt: created,
        },
        ON_DAY,
        'Asia/Kolkata',
      )!;
      expect(ymd(dob)).toBe('1994-10-14');
    });
  });

  it('the day before a birthday reads one year less, the birthday itself the full age', () => {
    const dob = utcDate(1981, 10, 15); // birthday tomorrow
    // 44 years 11 months 29 days → the single leading unit is still 44 Years.
    expect(printAge(dob, 45, AgeType.YEARS)).toBe('44 Years');
    // On the 45th birthday it reads the full 45.
    expect(printAge(utcDate(1981, 10, 14), 45, AgeType.YEARS)).toBe('45 Years');
  });
});
