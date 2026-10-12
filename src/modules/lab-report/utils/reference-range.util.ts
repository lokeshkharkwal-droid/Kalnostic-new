import { AgeType, AgeUnit, Gender, ReferenceGender } from '@prisma/client';
import {
  classifyAgeMatch,
  type AgeMatch,
} from '../../../common/utils/age-bounds.util';
import { normalizeUnit } from '../../../common/utils/unit-normalize.util';

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

/**
 * Put candidate reference rows in a deterministic order for the technician side:
 * the range that STARTS LATER (the higher Age From) comes first, then the narrower
 * one (the lower Age To). The database returns rows in no guaranteed order, and
 * two ranges for one parameter may legitimately both match on a calendar-edge day
 * ("0 to 28 Days" next to "1 to 11 Months" for a baby born in February, where one
 * month is only 28 days) — the later range must win, every time. Rows that tie on
 * both keep their incoming order (a stable sort).
 *
 * @param rows rows carrying `ageFrom`/`ageFromUnit`/`ageTo`/`ageToUnit`
 * @returns a new array; the input is not modified
 */
export function sortRangesByAgeSpecificity<
  T extends {
    ageFrom: number;
    ageFromUnit: AgeUnit;
    ageTo: number;
    ageToUnit: AgeUnit;
  },
>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      rangeAgeInDays(b.ageFrom, b.ageFromUnit) -
        rangeAgeInDays(a.ageFrom, a.ageFromUnit) ||
      rangeAgeInDays(a.ageTo, a.ageToUnit) -
        rangeAgeInDays(b.ageTo, b.ageToUnit),
  );
}

/** What the candidate order looks at. `createdAt` may be missing on a mock row. */
export interface CandidateOrderRow {
  id: string;
  isDefault: boolean;
  labAdapterId: string | null;
  method: string | null;
  unit: string | null;
  createdAt?: Date | null;
}

const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * The order the technician's Range list offers ranges in, as a comparator for
 * `Array.prototype.sort`. The database returns rows in no guaranteed order, so without this the
 * "first" range (and the automatic pick that takes it) changed between loads. The order:
 *  1. a Default range before a non-Default one;
 *  2. a range without an analyzer before an analyzer's range;
 *  3. then, so the order is always the same: by analyzer id, method, unit (all ignoring case),
 *     the oldest saved first, and finally by id.
 * (The caller puts "certain age fit" ahead of "age may fit" before using this.)
 *
 * @param a one range
 * @param b another range
 * @returns negative when `a` comes first, positive when `b` does, 0 only for the same row
 */
export function compareRangeCandidates(
  a: CandidateOrderRow,
  b: CandidateOrderRow,
): number {
  return (
    Number(b.isDefault) - Number(a.isDefault) ||
    Number(!!a.labAdapterId) - Number(!!b.labAdapterId) ||
    compareText(a.labAdapterId ?? '', b.labAdapterId ?? '') ||
    compareText(
      (a.method ?? '').trim().toLowerCase(),
      (b.method ?? '').trim().toLowerCase(),
    ) ||
    compareText(normalizeUnit(a.unit), normalizeUnit(b.unit)) ||
    (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
    compareText(a.id, b.id)
  );
}

/** The age unit (Days / Months / Years) that matches a patient's stored age unit. */
const UNIT_OF_AGE_TYPE: Record<AgeType, AgeUnit> = {
  [AgeType.DAYS]: AgeUnit.DAYS,
  [AgeType.MONTHS]: AgeUnit.MONTHS,
  [AgeType.YEARS]: AgeUnit.YEARS,
};

/** How a patient's age relates to a reference row's age band. `unknown` = the patient has no age. */
export type RangeAgeMatch = AgeMatch | 'unknown';

/**
 * Whether a patient's stored age falls in a reference row's age band, on the same
 * calendar rule as master data (see `classifyAgeMatch`): `match` when the age is
 * inside the band whatever the exact birth date, `none` when it is outside for
 * every birth date, `partial` when the stored age is too coarse to be sure (it
 * straddles a band edge, or sits on a calendar edge such as "30 Days" against
 * "1 Month"). `unknown` only when the age is genuinely missing (`null` /
 * `undefined`): an age of 0 is a real age (a newborn aged 0 days).
 *
 * @param patient the patient's stored age and its unit (an unset unit means years)
 * @param row a reference row's age band
 */
export function rangeAgeMatch(
  patient: {
    age: number | null | undefined;
    ageType: AgeType | null | undefined;
  },
  row: {
    ageFrom: number;
    ageFromUnit: AgeUnit;
    ageTo: number;
    ageToUnit: AgeUnit;
  },
): RangeAgeMatch {
  if (patient.age === null || patient.age === undefined) return 'unknown';
  return classifyAgeMatch(
    {
      value: patient.age,
      unit: UNIT_OF_AGE_TYPE[patient.ageType ?? AgeType.YEARS],
    },
    { value: row.ageFrom, unit: row.ageFromUnit },
    { value: row.ageTo, unit: row.ageToUnit },
  );
}

/** Whether a row may be picked automatically: its age band certainly fits, or the patient has no age. */
export function isExactAgeMatch(match: RangeAgeMatch): boolean {
  return match === 'match' || match === 'unknown';
}
