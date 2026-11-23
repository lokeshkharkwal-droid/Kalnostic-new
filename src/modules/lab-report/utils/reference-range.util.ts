import {
  AbnormalFlag,
  AgeType,
  AgeUnit,
  Gender,
  ReferenceGender,
  ResultFlagOption,
  ResultType,
} from '@prisma/client';
import {
  baseStyleOf,
  isHighLowStyle,
  HIGHLIGHT_FALLBACK_STYLE,
} from '../../../common/utils/abnormal-flag.util';
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
 * What a reading must look like to be compared with a reference range: an optional
 * sign, digits and at most one decimal point (`135`, `-2.1`, `+5`, `.5`, `5.`).
 * Anything else — an operator (`<5`, `>600`), letters (`Hemolysed`), a thousands separator
 * (`1,200`), an exponent or hex form (`1e3`, `0x1F`) — is NOT comparable.
 *
 * `Number()` alone is not used because it also accepts `1e3` and `0x1F`, which a
 * technician could type by accident and would then be compared as 1000 or 31.
 */
// Written without overlapping alternatives (`\d+(?:\.\d*)?`, not `\d+\.?\d*`) so a long run of digits followed by a
// letter fails in linear time instead of backtracking quadratically.
const COMPARABLE_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Read a reading as a number the system can compare with a reference range, or `null`
 * when it cannot (blank, or not a plain number — see {@link COMPARABLE_NUMBER}). A blank
 * reading is never `0`: `Number('')` is `0` in JS, which would wrongly flag an unfilled
 * result as out-of-range for any range whose lower limit is above zero.
 *
 * One shared rule for the printed report, the trend chart and (mirrored in
 * `range-highlight.ts`) the Technician entry grid.
 *
 * @param value the reading as typed / received
 * @returns the number, or `null` when the reading is not comparable
 */
export function parseComparableNumber(
  value: string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!COMPARABLE_NUMBER.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify one reading against its already-resolved reference range bounds. Narrow,
 * quantitative-only, no critical tier (product decision — see
 * `LabReportService.findTrend`'s own doc comment). Returns `null` whenever the inputs
 * don't actually support a real answer — no range was resolved for this value, or both
 * bounds are null, or the reading is not a comparable number (see
 * {@link parseComparableNumber}; always true for qualitative results, which never carry a
 * numeric reference range) — never guessed.
 */
export function computeTrendFlag(
  observed1: string | null,
  range: { lowerLimit: unknown; upperLimit: unknown } | undefined,
): TrendFlag | null {
  if (!range) return null;
  const value = parseComparableNumber(observed1);
  if (value === null) return null;

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
 * Whether one observed reading is out of its reference range for report display. True
 * only for a QUANTITATIVE parameter whose reading is a comparable number below the lower
 * limit or above the upper limit of its resolved range (via {@link computeTrendFlag}).
 * Qualitative/semi-quantitative parameters, blank or non-comparable readings, and readings
 * with no resolved range are all `false`.
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

/** The inline CSS of each BASIC style (a High Low style prints as the basic style it extends). */
const BASIC_STYLE_CSS: Readonly<Partial<Record<AbnormalFlag, string>>> = {
  [AbnormalFlag.RED_ONLY]: 'color:#d32f2f',
  [AbnormalFlag.BOLD_ONLY]: 'font-weight:bold',
  [AbnormalFlag.ITALIC]: 'font-style:italic',
  [AbnormalFlag.BOLD_AND_ITALIC]: 'font-weight:bold;font-style:italic',
  [AbnormalFlag.BOLD_AND_RED]: 'font-weight:bold;color:#d32f2f',
  [AbnormalFlag.ITALIC_AND_RED]: 'font-style:italic;color:#d32f2f',
  [AbnormalFlag.BOLD_ITALIC_AND_RED]:
    'font-weight:bold;font-style:italic;color:#d32f2f',
  [AbnormalFlag.UNDERLINE]: 'text-decoration:underline',
  [AbnormalFlag.COLOUR_HIGHLIGHT]: 'background-color:#fff176',
};

/**
 * The inline CSS that renders one {@link AbnormalFlag} choice in a printed report — one
 * look for every way a style is applied (a Quantitative value outside its range, or a
 * Technician's Highlight). A "…and High Low" style gets the CSS of the basic style it
 * extends; the High/Low word itself is added by the caller. Returns a bare `style` body
 * (no quotes, no trailing semicolon) so callers can drop it straight into
 * `<span style="…">`. Pure — no DB, no escaping.
 */
export function abnormalFlagStyle(flag: AbnormalFlag): string {
  // A value that is not one of the known styles (corrupt data, a new enum value without CSS yet) gets NO
  // styling. It must never be turned into Bold and Red: that substitution is only allowed for the
  // Technician's Highlight on a parameter with no style (`HIGHLIGHT_FALLBACK_STYLE`).
  return BASIC_STYLE_CSS[baseStyleOf(flag)] ?? '';
}

/** What {@link resolvePrintStyle} decided for one reading. */
export interface PrintStyleDecision {
  /** The style to print the value in, or `null` for Normal (plain) style. */
  style: AbnormalFlag | null;
  /** The word to print beside the value — only for a "…and High Low" style on a number outside its range. */
  label: 'Low' | 'High' | null;
  /** True only when the system itself judged the value out of range (Default option). */
  abnormal: boolean;
}

const NORMAL: PrintStyleDecision = {
  style: null,
  label: null,
  abnormal: false,
};

/**
 * THE single place the Abnormal Flag Logic v1.3 rules are applied: how one reading prints.
 *
 *  - blank reading → Normal (nothing to flag), whatever the option;
 *  - NOT_HIGHLIGHT → Normal, whatever the value;
 *  - HIGHLIGHT → the technician's chosen style (or, if none was chosen, the basic style of
 *    the parameter's style, or Bold and Red when the parameter has no style), whatever the value,
 *    for every result type; never a High Low word;
 *  - DEFAULT → only a QUANTITATIVE reading that is a comparable number outside its range, of a
 *    parameter that HAS a style, is styled, in that style, plus the word Low/High when that is a
 *    High Low style; a parameter without a style, a reading that cannot be compared (`<5`, `>600`,
 *    `Hemolysed`), a number with no range, and every Semi-Quantitative / Qualitative reading
 *    print Normal.
 *
 * @param input the reading, its option and the parameter's setup
 * @returns the style (null = Normal), the High/Low word (if any) and whether the system flagged it
 */
export function resolvePrintStyle(input: {
  resultType: ResultType | null | undefined;
  /** The parameter's Abnormal Flag Logic; null = no style set (optional). */
  paramStyle: AbnormalFlag | null;
  flagOption: ResultFlagOption;
  /** The technician's Highlight choice (`highlightLogic`); read only under HIGHLIGHT. */
  selectedStyle: AbnormalFlag | null;
  observed: string | null;
  range: { lowerLimit: unknown; upperLimit: unknown } | undefined;
}): PrintStyleDecision {
  if ((input.observed ?? '').trim() === '') return NORMAL;
  if (input.flagOption === ResultFlagOption.NOT_HIGHLIGHT) return NORMAL;
  if (input.flagOption === ResultFlagOption.HIGHLIGHT) {
    return {
      style: baseStyleOf(
        input.selectedStyle ?? input.paramStyle ?? HIGHLIGHT_FALLBACK_STYLE,
      ),
      label: null,
      abnormal: false,
    };
  }
  if (input.resultType !== ResultType.QUANTITATIVE) return NORMAL;
  // No style set on the parameter: nothing to style a Default reading with.
  if (input.paramStyle === null) return NORMAL;
  const flag = computeTrendFlag(input.observed, input.range);
  if (flag !== 'Low' && flag !== 'High') return NORMAL;
  return {
    style: input.paramStyle,
    label: isHighLowStyle(input.paramStyle) ? flag : null,
    abnormal: true,
  };
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
