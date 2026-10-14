import { AgeType, AgeUnit } from '@prisma/client';
import { dobFromAge, exactBirthDate } from './age-dob.util';
import {
  patientFullAgeDisplay,
  patientReportAgeDisplay,
  patientSingleUnitAgeDisplay,
} from './patient-label.util';
import {
  isExactAgeMatch,
  rangeAgeMatch,
} from '../../modules/lab-report/utils/reference-range.util';

/**
 * A saved patient's age is edited (35 -> 45). Everything that prints or uses the age reads the DATE OF BIRTH first and the stored
 * age only when there is no date of birth:
 *   - the sample barcode label (`patientSingleUnitAgeDisplay`),
 *   - the bill / order slip / TRF (`patientFullAgeDisplay`),
 *   - the lab report (`patientReportAgeDisplay`),
 *   - the technician's reference range (`exactBirthDate` + the age bands).
 * So the age and the date of birth the form saves must AGREE. The first test shows what a stale date of birth does (the reported
 * bug); the rest show that a re-made date of birth makes every one of them read 45.
 */
describe('patient age is consistent everywhere once the date of birth follows the edited age', () => {
  const TODAY = new Date(Date.UTC(2026, 9, 14, 12, 0, 0)); // 14 Oct 2026
  const ON_DAY = new Date(Date.UTC(2026, 9, 14));
  const utcDate = (y: number, m: number, d: number) =>
    new Date(Date.UTC(y, m - 1, d));
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const prints = (
    dob: Date | null,
    age: number | null,
    ageType: AgeType | null,
  ) => ({
    barcodeLabel: patientSingleUnitAgeDisplay(dob, age, ageType, TODAY),
    billAndTrf: patientFullAgeDisplay(dob, age, ageType, TODAY),
    report: patientReportAgeDisplay(dob, age, ageType, TODAY),
  });

  it('THE REPORTED BUG: age 45 stored next to the OLD date of birth (35 years ago) prints 35 everywhere', () => {
    expect(prints(utcDate(1991, 10, 14), 45, AgeType.YEARS)).toEqual({
      barcodeLabel: '35 Years',
      billAndTrf: '35 Years, 0 Months, 0 Days',
      report: '35 Years',
    });
  });

  it('age 45 with the date of birth re-made from it prints 45 everywhere', () => {
    const dob = dobFromAge(45, AgeType.YEARS, ON_DAY)!;
    expect(ymd(dob)).toBe('1981-10-14');
    expect(prints(dob, 45, AgeType.YEARS)).toEqual({
      barcodeLabel: '45 Years',
      billAndTrf: '45 Years, 0 Months, 0 Days',
      report: '45 Years',
    });
  });

  it('every age from 2 to 150 years reads back unchanged on all three prints', () => {
    for (let age = 2; age <= 150; age++) {
      const dob = dobFromAge(age, AgeType.YEARS, ON_DAY)!;
      expect(prints(dob, age, AgeType.YEARS)).toEqual({
        barcodeLabel: `${age} Years`,
        billAndTrf: `${age} Years, 0 Months, 0 Days`,
        report: `${age} Years`,
      });
    }
  });

  it('months and days read back in their own unit', () => {
    const threeMonths = dobFromAge(3, AgeType.MONTHS, ON_DAY)!;
    expect(prints(threeMonths, 3, AgeType.MONTHS)).toMatchObject({
      barcodeLabel: '3 Months',
      report: '3 Months',
    });
    const twentyDays = dobFromAge(20, AgeType.DAYS, ON_DAY)!;
    expect(prints(twentyDays, 20, AgeType.DAYS)).toMatchObject({
      barcodeLabel: '20 Days',
      report: '20 Days',
    });
  });

  it('a patient with no date of birth still prints the stored age (nothing to disagree with)', () => {
    expect(prints(null, 45, AgeType.YEARS)).toEqual({
      barcodeLabel: '45 Years',
      billAndTrf: '45 Years',
      report: '45 Years',
    });
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
    expect(patientReportAgeDisplay(dob, 45, AgeType.YEARS, TODAY)).toBe(
      '44 Years',
    );
    expect(patientFullAgeDisplay(dob, 45, AgeType.YEARS, TODAY)).toBe(
      '44 Years, 11 Months, 29 Days',
    );
    expect(
      patientReportAgeDisplay(utcDate(1981, 10, 14), 45, AgeType.YEARS, TODAY),
    ).toBe('45 Years');
  });
});
