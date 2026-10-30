import {
  AbnormalFlag,
  AgeType,
  AgeUnit,
  Gender,
  ReferenceGender,
  ResultType,
} from '@prisma/client';
import {
  classifyAgeMatch,
  type AgeMatch,
} from '../../../common/utils/age-bounds.util';
import { dobInAgeBand } from '../../../common/utils/age-dob.util';
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
 *
 * A blank reading (`null`, `''`, or whitespace only) is treated as "no numeric
 * value" (→ `null`), NOT as `0`: `Number('')` is `0` in JS, which would wrongly
 * flag an empty result as out-of-range for any range whose lower limit is above
 * zero (the common case) — e.g. an unfilled Observed 2.
 */
export function computeTrendFlag(
  observed1: string | null,
  range: { lowerLimit: unknown; upperLimit: unknown } | undefined,
): TrendFlag | null {
  if (!range) return null;
  const trimmed = observed1 === null ? '' : observed1.trim();
  const value = trimmed === '' ? NaN : Number(trimmed);
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
 * The inline CSS that renders one {@link AbnormalFlag} choice in a printed
 * report. Keyed off `LabTestReferenceRange.abnormalFlagLogic` (the styling the
 * lab configured for an out-of-range quantitative reading under Master Data →
 * Reference Range), this is what wraps an observed value when it falls below the
 * lower limit or above the upper limit — see
 * `LabReportService.buildPrintContext`. Returns a bare `style` body (no quotes,
 * no trailing semicolon) so callers can drop it straight into
 * `<span style="…">`. Pure — no DB, no escaping.
 */
/**
 * Whether one observed reading should be treated as abnormal (out of range) for
 * report display. True only for a QUANTITATIVE parameter whose value falls below
 * the lower limit or above the upper limit of its resolved reference range (via
 * {@link computeTrendFlag}). Qualitative/semi-quantitative parameters, blank or
 * non-numeric readings, and readings with no resolved range are all `false`.
 * Single source of truth for both the `{is_observed_*_abnormal}` tags and the
 * abnormal styling in `LabReportService.buildPrintContext`.
 */
export function isObservedAbnormal(
  observed: string | null,
  resultType: ResultType | null | undefined,
  range: { lowerLimit: unknown; upperLimit: unknown } | undefined,
): boolean {
  if (resultType !== ResultType.QUANTITATIVE) return false;
  const flag = computeTrendFlag(observed, range);
  return flag === 'Low' || flag === 'High';
}

export function abnormalFlagStyle(flag: AbnormalFlag): string {
  switch (flag) {
    case AbnormalFlag.BOLD_AND_RED:
      return 'font-weight:bold;color:#d32f2f';
    case AbnormalFlag.BOLD_ONLY:
      return 'font-weight:bold';
    case AbnormalFlag.ITALIC:
      return 'font-style:italic';
    case AbnormalFlag.UNDERLINE:
      return 'text-decoration:underline';
    case AbnormalFlag.COLOUR_HIGHLIGHT:
      return 'background-color:#fff176';
  }
}

/**
 * Visual style for a value the technician manually flagged via the Test Entry
 * "Highlight in Report" control (QUALITATIVE / SEMI_QUANTITATIVE only). Kept
 * SEPARATE from {@link abnormalFlagStyle} on purpose: out-of-range quantitative
 * values keep their long-standing bright bold red, while this manual highlight
 * uses a calmer, more professional clinical treatment — semibold weight with a
 * deeper, less-saturated red — so a deliberately-emphasised categorical result
 * reads as a clean highlight rather than an alarm. Shares the `AbnormalFlag`
 * palette for the non-default options so the one field can drive both.
 */
export function reportHighlightStyle(flag: AbnormalFlag): string {
  switch (flag) {
    case AbnormalFlag.BOLD_AND_RED:
      return 'font-weight:600;color:#b91c1c';
    case AbnormalFlag.BOLD_ONLY:
      return 'font-weight:600';
    case AbnormalFlag.ITALIC:
      return 'font-style:italic';
    case AbnormalFlag.UNDERLINE:
      return 'text-decoration:underline';
    case AbnormalFlag.COLOUR_HIGHLIGHT:
      return 'background-color:#fde68a;padding:0 2px;border-radius:2px';
  }
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
 * @param exact the patient's exact birth date and the day their age is measured on (the sample collection day),
 *   when known: the calendar then decides (`match` or `none`, never `partial`) and the stored age is not used
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
  exact?: ExactAge | null,
): RangeAgeMatch {
  if (exact) {
    const inBand = dobInAgeBand(exact.dob, exact.onDay, row);
    if (inBand !== null) return inBand ? 'match' : 'none';
  }
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

/** A patient's exact birth date and the calendar day their age is measured on (both UTC-midnight dates). */
export interface ExactAge {
  dob: Date;
  onDay: Date;
}

/** Whether a row may be picked automatically: its age band certainly fits, or the patient has no age. */
export function isExactAgeMatch(match: RangeAgeMatch): boolean {
  return match === 'match' || match === 'unknown';
}

/** The oldest age a range must reach to count as "all ages" (a patient never lives longer). */
const ALL_AGES_UP_TO_YEARS = 120;

/**
 * Whether a range fits EVERY patient whatever their age: it starts at birth and runs to at least 120 years (the
 * default band is 0 to 999 Years). Such a range is safe to pick for a patient whose age is not known.
 */
export function coversAllAges(row: {
  ageFrom: number;
  ageFromUnit: AgeUnit;
  ageTo: number;
  ageToUnit: AgeUnit;
}): boolean {
  const toInYears =
    row.ageToUnit === AgeUnit.YEARS
      ? row.ageTo
      : row.ageToUnit === AgeUnit.MONTHS
        ? row.ageTo / 12
        : row.ageTo / 365;
  return row.ageFrom === 0 && toInYears >= ALL_AGES_UP_TO_YEARS;
}

/**
 * How a range relates to the patient's age for the technician's Range LIST (the quantitative picker). Same as
 * {@link rangeAgeMatch}, except for a patient with NO age (and no date of birth): a range that covers all ages
 * certainly fits (`match`, so it may be picked automatically), any other range stays `unknown` and is only listed,
 * so the technician chooses. (The text-type lookups keep using {@link rangeAgeMatch}.)
 *
 * @param patient the patient's stored age and its unit
 * @param row a reference row's age band
 * @param exact the patient's exact birth date and measuring day, when known (see {@link rangeAgeMatch})
 */
export function candidateAgeMatch(
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
  exact?: ExactAge | null,
): RangeAgeMatch {
  if (!exact && (patient.age === null || patient.age === undefined)) {
    return coversAllAges(row) ? 'match' : 'unknown';
  }
  return rangeAgeMatch(patient, row, exact);
}

/** Sort position of a range in the Range list: certain fits first, then ones that cannot be told, then maybes. */
export function candidateAgeRank(match: RangeAgeMatch): number {
  return match === 'match' ? 0 : match === 'unknown' ? 1 : 2;
}
