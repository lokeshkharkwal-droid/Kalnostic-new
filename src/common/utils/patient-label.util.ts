import { AgeType, Salutation } from '@prisma/client';

/**
 * Human-readable label for a patient's `Salutation`, for display in print
 * templates (`{patient_salutation}`) instead of the raw SCREAMING enum (`MR`).
 * `undefined`/`null` (never set) renders as `''` (no salutation prefix).
 * Mirrors `genderLabel`'s pattern (`gender-label.util.ts`).
 */
export function salutationLabel(
  salutation: Salutation | null | undefined,
): string {
  switch (salutation) {
    case Salutation.DR:
      return 'Dr.';
    case Salutation.MR:
      return 'Mr.';
    case Salutation.MRS:
      return 'Mrs.';
    case Salutation.MS:
      return 'Ms.';
    case Salutation.PROF:
      return 'Prof.';
    default:
      return '';
  }
}

/**
 * Patient age with its unit for print templates (`{patient_age}`) — e.g.
 * `"45 Years"`, `"1 Year"`, `"6 Months"`, `"10 Days"` — derived from the
 * patient's `age` (a plain integer) and `ageType` (`YEARS`/`MONTHS`/`DAYS`,
 * defaulting to years when unset). The unit is singularised for an age of 1.
 * Empty string when `age` is null/undefined so the tag renders blank rather
 * than a bare unit.
 */
export function patientAgeDisplay(
  age: number | null | undefined,
  ageType: AgeType | null | undefined,
): string {
  if (age === null || age === undefined) {
    return '';
  }
  const unit =
    ageType === AgeType.MONTHS
      ? 'Month'
      : ageType === AgeType.DAYS
        ? 'Day'
        : 'Year';
  return `${age} ${unit}${age === 1 ? '' : 's'}`;
}
