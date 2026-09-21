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

/** Pluralise `n <unit>` — e.g. `1 Year`, `4 Months`. */
function unitPart(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * Full patient age as `"25 Years, 4 Months, 12 Days"` for print templates
 * (`{patient_age}`). When the patient's `dateOfBirth` is known this is computed
 * as a Years/Months/Days breakdown from DOB to `now` (all three components are
 * always shown, each singularised for a value of 1). `dateOfBirth` is stored
 * date-only at UTC midnight (`@db.Date`), so the diff is done with UTC getters
 * to avoid timezone drift.
 *
 * When `dateOfBirth` is missing, in the future, or invalid, this falls back to
 * the single-unit {@link patientAgeDisplay} derived from `age`/`ageType`
 * (which is itself `''` when `age` is unknown), so the tag never renders a bare
 * unit or a nonsensical negative breakdown.
 *
 * @param dateOfBirth the patient's date of birth (may be null)
 * @param age the denormalised age snapshot (fallback)
 * @param ageType the unit of `age` (fallback)
 * @param now reference date for the breakdown; defaults to the current date
 * @returns the formatted age string, or `''` when nothing is known
 */
export function patientFullAgeDisplay(
  dateOfBirth: Date | null | undefined,
  age: number | null | undefined,
  ageType: AgeType | null | undefined,
  now: Date = new Date(),
): string {
  if (dateOfBirth && !Number.isNaN(dateOfBirth.getTime())) {
    let years = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
    let months = now.getUTCMonth() - dateOfBirth.getUTCMonth();
    let days = now.getUTCDate() - dateOfBirth.getUTCDate();
    if (days < 0) {
      // Borrow days from the month before `now` (day 0 of the current month
      // gives the previous month's length).
      months -= 1;
      days += new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0),
      ).getUTCDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    if (years >= 0 && months >= 0 && days >= 0) {
      return `${unitPart(years, 'Year')}, ${unitPart(months, 'Month')}, ${unitPart(days, 'Day')}`;
    }
  }
  // No DOB (or DOB in the future / invalid) → single-unit snapshot.
  return patientAgeDisplay(age, ageType);
}
