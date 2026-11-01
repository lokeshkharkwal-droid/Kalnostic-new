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

/**
 * Calendar Years/Months/Days elapsed from `dateOfBirth` to `now`.
 * `dateOfBirth` is stored date-only at UTC midnight (`@db.Date`), so the diff
 * is done with UTC getters to avoid timezone drift.
 * @returns the breakdown, or `null` when `dateOfBirth` is missing, invalid, or
 * in the future
 */
function ageBreakdownFromDob(
  dateOfBirth: Date | null | undefined,
  now: Date,
): { years: number; months: number; days: number } | null {
  if (!dateOfBirth || Number.isNaN(dateOfBirth.getTime())) {
    return null;
  }
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
  return years >= 0 && months >= 0 && days >= 0
    ? { years, months, days }
    : null;
}

/**
 * Patient age for **every print template** — the single source of truth for the
 * `{patient_age}` tag (bill, TRF, order slip, quotation, sample label, single
 * lab report and lab panel) and the `{client_age}` tag (all-reports header). One
 * shared rule, so the age reads identically on every document:
 *
 *  - **12 months or older → Years.** 25 years 4 months 10 days → `25 Years`;
 *    1 year 2 months → `1 Year`; exactly 12 months → `1 Year`.
 *  - **1 to 11 months → Months.** 11 months 20 days → `11 Months`;
 *    6 months 15 days → `6 Months`; 1 month 15 days → `1 Month`.
 *  - **Under 1 month → Days.** 20 days → `20 Days`; 5 days → `5 Days`.
 *
 * Only the single leading unit is shown (never the full "Y Years, M Months,
 * D Days" breakdown), singularised for a value of 1 (via
 * {@link patientAgeDisplay}). The breakdown is computed from `dateOfBirth` to
 * `now`; `dateOfBirth` is stored date-only at UTC midnight (`@db.Date`), so the
 * diff uses UTC getters (see {@link ageBreakdownFromDob}) to avoid timezone
 * drift. Because the bands key off the Years/Months breakdown (completed
 * calendar units), a baby who is 30 calendar days old but not yet a full month
 * reads in Days, and one who is exactly one month old reads `1 Month`.
 *
 * When `dateOfBirth` is missing, in the future, or invalid, this falls back to
 * the stored `age`/`ageType` snapshot (itself `''` when `age` is unknown), so
 * the tag never renders a bare unit or a nonsensical negative breakdown.
 *
 * @param dateOfBirth the patient's date of birth (may be null)
 * @param age the denormalised age snapshot (fallback)
 * @param ageType the unit of `age` (fallback)
 * @param now reference date, read via UTC getters — pass a tenant-local
 *   wall-clock instant (`toBranchLocalInstant`) so the day is the branch's
 *   calendar day; defaults to the current date
 * @returns the formatted age string, or `''` when nothing is known
 */
export function patientPrintAgeDisplay(
  dateOfBirth: Date | null | undefined,
  age: number | null | undefined,
  ageType: AgeType | null | undefined,
  now: Date = new Date(),
): string {
  const breakdown = ageBreakdownFromDob(dateOfBirth, now);
  if (!breakdown || !dateOfBirth) {
    return patientAgeDisplay(age, ageType);
  }
  // 12 months or older — `years >= 1` means at least 12 completed months.
  if (breakdown.years >= 1) {
    return patientAgeDisplay(breakdown.years, AgeType.YEARS);
  }
  // 1 to 11 completed months.
  if (breakdown.months >= 1) {
    return patientAgeDisplay(breakdown.months, AgeType.MONTHS);
  }
  // Under one completed month — `breakdown.days` is the total age in days here.
  return patientAgeDisplay(breakdown.days, AgeType.DAYS);
}
