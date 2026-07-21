import { AgeType, AgeUnit, Gender, ReferenceGender } from '@prisma/client';

/** Convert a patient's age (in its own stored unit) to total days, for range comparison. */
export function patientAgeInDays(age: number, ageType: AgeType): number {
  switch (ageType) {
    case AgeType.DAYS:
      return age;
    case AgeType.MONTHS:
      return age * 30;
    case AgeType.YEARS:
      return age * 365;
  }
}

/** Convert an `ageFrom`/`ageTo` bound (in its own stored unit) to total days. */
export function rangeAgeInDays(value: number, unit: AgeUnit): number {
  switch (unit) {
    case AgeUnit.DAYS:
      return value;
    case AgeUnit.MONTHS:
      return value * 30;
    case AgeUnit.YEARS:
      return value * 365;
  }
}

/** Whether a reference row's gender scope matches the patient's gender. ALL matches everyone. */
export function genderMatches(
  rangeGender: ReferenceGender,
  patientGender: Gender | null,
): boolean {
  if (rangeGender === ReferenceGender.ALL) return true;
  if (!patientGender) return false;
  return (
    (rangeGender === ReferenceGender.MALE && patientGender === Gender.MALE) ||
    (rangeGender === ReferenceGender.FEMALE && patientGender === Gender.FEMALE)
  );
}
