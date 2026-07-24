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

export type TrendFlag = 'Low' | 'Normal' | 'High';

/**
 * Classify one trend point's primary observed value against its already-resolved
 * reference range bounds. Narrow, quantitative-only, no critical tier (product
 * decision — see `LabReportService.findTrend`'s own doc comment for why this is
 * NOT the deferred system-wide range-classification feature). Returns `null`
 * whenever the inputs don't actually support a real answer — no range was
 * resolved for this value, or the bound(s) needed are themselves null, or
 * `observed1` isn't a finite number (always true for qualitative results,
 * which never carry a numeric reference range at all) — never guessed.
 */
export function computeTrendFlag(
  observed1: string | null,
  range: { lowerLimit: unknown; upperLimit: unknown } | undefined,
): TrendFlag | null {
  if (!range) return null;
  const value = observed1 === null ? NaN : Number(observed1);
  if (!Number.isFinite(value)) return null;

  const lower =
    range.lowerLimit === null || range.lowerLimit === undefined
      ? null
      : Number(range.lowerLimit);
  const upper =
    range.upperLimit === null || range.upperLimit === undefined
      ? null
      : Number(range.upperLimit);
  if (lower === null && upper === null) return null;
  if (lower !== null && !Number.isFinite(lower)) return null;
  if (upper !== null && !Number.isFinite(upper)) return null;

  if (lower !== null && value < lower) return 'Low';
  if (upper !== null && value > upper) return 'High';
  return 'Normal';
}
