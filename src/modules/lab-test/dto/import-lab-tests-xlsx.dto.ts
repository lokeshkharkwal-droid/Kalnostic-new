import {
  AbnormalFlag,
  AgeUnit,
  ContainerType,
  DayOfWeek,
  ParameterType,
  ProcessMethod,
  ReferenceGender,
  RepeatIntervalUnit,
  ResultRounding,
  ResultType,
  SamplePriority,
  TatUnit,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** 24-hour `HH:mm` clock time (branch-local), e.g. `08:30`. */
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * ONE flat worksheet, 120 columns, based on the reference file
 * `IMPORT & EXPORT - IMPORT & EXPORT.csv` (header text/order/typos copied
 * verbatim — "Conatiner Type", "imgae settings", "reflex test" are the real
 * column names, not mistakes to fix) PLUS 3 columns the reference file didn't
 * have: "Mandatory Department" (right after "Mandatory Test"), "Repeat
 * Interval Value" and "Repeat Interval Unit" (right after "Repeat Interval
 * Restriction"). Those 3 were added because `assertCoreInvariants` requires
 * them whenever the paired boolean flag is true, and the original 117-column
 * format had no column to satisfy that — setting "Mandatory Test"/"Repeat
 * Interval Restriction" to Yes via Excel was a dead end otherwise (confirmed
 * by a real user hitting exactly this in testing). A test spans one or more
 * physical rows: the Test-level scalar columns (this DTO's own fields,
 * everything up to and including `isActive`/Notes) are populated ONLY on the
 * test's FIRST row — every continuation row leaves them blank, which is how
 * the parser groups rows back into one test (see `groupTestRowSpans` in
 * `lab-test.service.ts`). One `ImportXlsxTestRowDto` is the fully-assembled
 * result of that grouping: the scalars from the first row, plus the
 * positionally-aligned `samples` and the contiguous-block-parsed
 * `resultParams` (each carrying its own nested `referenceRanges`/
 * `referenceValues`).
 */
export class ImportXlsxTestRowDto {
  /** e.g. "Row 3" or "Rows 3-8" — echoed in validation errors. */
  @IsString()
  @IsOptional()
  rowLabel?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  testName: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  testDisplayName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  testCode: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  aka?: string;

  @IsString()
  @IsOptional()
  departmentId?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  subCategoryId?: string;

  @IsEnum(ProcessMethod)
  @IsOptional()
  processMethod?: ProcessMethod;

  /** Free-text logical ref (no lookup table exists yet). */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  approvalWorkflowId?: string;

  @IsBoolean()
  @IsOptional()
  isMandatoryTest?: boolean;

  /** Which department this test is mandatory for. Required (by
   * `assertCoreInvariants`) when `isMandatoryTest` is true — resolved from
   * the "Mandatory Department" column's department NAME to an id the same
   * way `departmentId` is (see `namesToIds`/`resolveOptionalNameField` in
   * `importXlsx`). */
  @IsString()
  @IsOptional()
  mandatoryDeptId?: string;

  @IsBoolean()
  @IsOptional()
  isRepeatIntervalRestriction?: boolean;

  /** How often this test may be repeated. Both required (by
   * `assertCoreInvariants`) when `isRepeatIntervalRestriction` is true. */
  @IsInt()
  @Min(1)
  @IsOptional()
  repeatIntervalValue?: number;

  @IsEnum(RepeatIntervalUnit)
  @IsOptional()
  repeatIntervalUnit?: RepeatIntervalUnit;

  @IsBoolean()
  @IsOptional()
  isHideInOrderScreen?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  clinicalTags?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(50)
  icdCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  loincCode?: string;

  /** Free-text logical ref (no lookup table exists yet). */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  reportTemplateId?: string;

  @IsEnum(SamplePriority)
  @IsOptional()
  samplePriorityType?: SamplePriority;

  /** Free-text logical ref (no lookup table exists yet). */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  pdfSettingsId?: string;

  /** Free-text logical ref (no lookup table exists yet). */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  imageSettingsId?: string;

  @IsBoolean()
  @IsOptional()
  isEnableCms?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  priceMsrp?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  priceMaximum?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  priceMinimum?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  priceOriginal?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  franchisePrice?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  emergencyPrice?: number;

  @IsBoolean()
  @IsOptional()
  isAllowPriceOverride?: boolean;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  discountCapPct?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  tatMinValue?: number;

  @IsEnum(TatUnit)
  @IsOptional()
  tatMinUnit?: TatUnit;

  @IsInt()
  @Min(0)
  @IsOptional()
  tatMaxValue?: number;

  @IsEnum(TatUnit)
  @IsOptional()
  tatMaxUnit?: TatUnit;

  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  @ArrayUnique()
  @IsOptional()
  scheduleDays?: DayOfWeek[];

  @IsString()
  @Matches(HH_MM, { message: 'scheduleFrom must be a 24h HH:mm time' })
  @IsOptional()
  scheduleFrom?: string;

  @IsString()
  @Matches(HH_MM, { message: 'scheduleTo must be a 24h HH:mm time' })
  @IsOptional()
  scheduleTo?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  procTimeMinValue?: number;

  @IsEnum(TatUnit)
  @IsOptional()
  procTimeMinUnit?: TatUnit;

  @IsInt()
  @Min(0)
  @IsOptional()
  procTimeMaxValue?: number;

  @IsEnum(TatUnit)
  @IsOptional()
  procTimeMaxUnit?: TatUnit;

  @IsInt()
  @Min(0)
  @IsOptional()
  approvalDurationMinValue?: number;

  @IsEnum(TatUnit)
  @IsOptional()
  approvalDurationMinUnit?: TatUnit;

  @IsInt()
  @Min(0)
  @IsOptional()
  approvalDurationMaxValue?: number;

  @IsEnum(TatUnit)
  @IsOptional()
  approvalDurationMaxUnit?: TatUnit;

  @IsString()
  @Matches(HH_MM, { message: 'reportingTimeFrom must be a 24h HH:mm time' })
  @IsOptional()
  reportingTimeFrom?: string;

  @IsString()
  @Matches(HH_MM, { message: 'reportingTimeTo must be a 24h HH:mm time' })
  @IsOptional()
  reportingTimeTo?: string;

  // `Bill Only Test` / `Outsource` / `Sample Flow` have no matching DB field
  // on LabTest (verified against prisma/schema.prisma) — export-only,
  // ignored on import. Not modelled here.

  @IsBoolean()
  @IsOptional()
  isAllowDiscounts?: boolean;

  @IsBoolean()
  @IsOptional()
  isPreferenceTest?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ── Notes block (test-level, first row only) ──────────────────────────────
  @IsString()
  @IsOptional()
  usefulFor?: string;

  @IsString()
  @IsOptional()
  interpretationOfResults?: string;

  @IsString()
  @IsOptional()
  limitations?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  references?: string;

  // ── Children (assembled by the row-expansion parser) ──────────────────────
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportXlsxSampleRowDto)
  samples?: ImportXlsxSampleRowDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportXlsxResultParamRowDto)
  resultParams?: ImportXlsxResultParamRowDto[];
}

/** One Sample "block" — aligns positionally within the test's row-span. */
export class ImportXlsxSampleRowDto {
  @IsString()
  @IsOptional()
  rowLabel?: string;

  /** Free-text logical ref (no lookup table exists yet). */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  sampleNameId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  sampleType?: string;

  @IsEnum(ContainerType)
  @IsOptional()
  containerType?: ContainerType;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  sampleSize?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  collectionMethod?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  numberOfSamples?: number;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  stability?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  transportTemperature?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  preservative?: string;

  @IsString()
  @IsOptional()
  sampleHandlingInstructions?: string;

  @IsBoolean()
  @IsOptional()
  isFastingRequired?: boolean;

  @IsBoolean()
  @IsOptional()
  isLightProtection?: boolean;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

/** One Result Parameter "block" — contiguous rows, first-row-only fields. */
export class ImportXlsxResultParamRowDto {
  @IsString()
  @IsOptional()
  rowLabel?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  groupName?: string;

  /** Free-text logical ref (no lookup table exists yet). */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  groupLayoutId?: string;

  /** Free-text logical ref (no lookup table exists yet). */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  groupSettingsId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  parameterName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  parameterCode: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  method?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  reportingUnit?: string;

  @IsEnum(ResultType)
  resultType: ResultType;

  @IsEnum(ParameterType)
  @IsOptional()
  parameterType?: ParameterType;

  @IsBoolean()
  @IsOptional()
  isNabl?: boolean;

  @IsBoolean()
  @IsOptional()
  isCap?: boolean;

  @IsEnum(ResultRounding)
  @IsOptional()
  resultRoundingType?: ResultRounding;

  /** Free-text logical ref (no lookup table exists yet). */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  iconSettingsId?: string;

  // `imgae settings` (sic) has no matching per-parameter DB field on
  // LabTestResultParam (verified against prisma/schema.prisma) — export-only,
  // ignored on import. Not modelled here.

  /**
   * `reflex test` — semicolon-separated NAMES (e.g. "FT3; FT4"). The DB
   * stores `reflexTests` as a `[{id, name}]` JSON snapshot; for v1 this
   * column is EXPORT-ONLY/informational on import — no name→id lookup is
   * built, so it is intentionally not carried into the write payload.
   * Retained here only so `buildParamRowDto` can read it for completeness
   * checks/echoing; never sent to Prisma (see `cleanParamDtos`).
   */
  @IsString()
  @IsOptional()
  reflexTestNames?: string;

  @IsString()
  @IsOptional()
  calculationFormula?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  allowableUnits?: string;

  /** Per-PARAMETER notes (`LabTestResultParam.notes`) — distinct from the
   * per-TEST Notes block (`usefulFor`/`interpretationOfResults`/etc.). */
  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportXlsxReferenceRangeRowDto)
  referenceRanges?: ImportXlsxReferenceRangeRowDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportXlsxReferenceValueRowDto)
  referenceValues?: ImportXlsxReferenceValueRowDto[];
}

/**
 * One Reference Range row. `parameterName` here is the range's OWN
 * human-readable label copy (the CSV's "REFERENCE RANGE" block has its own
 * `Parameter Name` column) — NOT the join key. The join key is purely
 * positional: "whichever Parameter block most recently had non-blank
 * Parameter Name" (contiguous-block rule). `paramId` is set post-write by
 * `createParams`, never read from the sheet (there is no id column in this
 * format).
 */
export class ImportXlsxReferenceRangeRowDto {
  @IsString()
  @IsOptional()
  rowLabel?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  method?: string;

  @IsEnum(ReferenceGender)
  @IsOptional()
  gender?: ReferenceGender;

  @IsInt()
  @Min(0)
  @IsOptional()
  ageFrom?: number;

  @IsEnum(AgeUnit)
  @IsOptional()
  ageFromUnit?: AgeUnit;

  @IsInt()
  @Min(0)
  @IsOptional()
  ageTo?: number;

  @IsEnum(AgeUnit)
  @IsOptional()
  ageToUnit?: AgeUnit;

  @IsNumber()
  @IsOptional()
  lowerLimit?: number;

  @IsNumber()
  @IsOptional()
  upperLimit?: number;

  @IsNumber()
  @IsOptional()
  criticalMin?: number;

  @IsNumber()
  @IsOptional()
  criticalMax?: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  displayOfReferenceRange?: string;

  @IsEnum(AbnormalFlag)
  @IsOptional()
  abnormalFlagLogic?: AbnormalFlag;
}

/** One Reference Value row — same join-key treatment as `ImportXlsxReferenceRangeRowDto`. */
export class ImportXlsxReferenceValueRowDto {
  @IsString()
  @IsOptional()
  rowLabel?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  method?: string;

  @IsEnum(ReferenceGender)
  @IsOptional()
  gender?: ReferenceGender;

  @IsInt()
  @Min(0)
  @IsOptional()
  ageFrom?: number;

  @IsEnum(AgeUnit)
  @IsOptional()
  ageFromUnit?: AgeUnit;

  @IsInt()
  @Min(0)
  @IsOptional()
  ageTo?: number;

  @IsEnum(AgeUnit)
  @IsOptional()
  ageToUnit?: AgeUnit;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  normalValueText: string;

  @IsEnum(AbnormalFlag)
  @IsOptional()
  abnormalFlagLogic?: AbnormalFlag;
}

// ── Single worksheet: name + full 120-column header list, in order ─────────

/** The one worksheet name the uploaded workbook must contain. */
export const XLSX_SHEET_NAME = 'Lab Tests' as const;

/**
 * The full 120-column header list: the reference file's 117 columns, EXACT
 * text/order from `IMPORT & EXPORT - IMPORT & EXPORT.csv` (row 2 — row 1 is
 * blank), plus 3 columns added on top ("Mandatory Department", "Repeat
 * Interval Value", "Repeat Interval Unit" — see the doc comment on
 * `ImportXlsxTestRowDto` for why). Typos ("Conatiner Type", "imgae
 * settings") and the lowercase/uppercase mix ("reporting unit" vs "GENDER")
 * are copied verbatim from the reference file — they are the real contract,
 * not mistakes.
 */
export const XLSX_COLUMNS = [
  'Test Name',
  'Test Display Name',
  'Test Code',
  'AKA(also known as)',
  'Department',
  'Category',
  'Sub Category',
  'Process Method',
  'Approval Workflow',
  'Mandatory Test',
  'Mandatory Department',
  'Repeat Interval Restriction',
  'Repeat Interval Value',
  'Repeat Interval Unit',
  'Hide in Order Screen',
  'Clinical Tags',
  'ICD Code',
  'LOINC Code',
  'Report Template',
  'Sample Priority Type',
  'PDF Settings',
  'Image Settings',
  'Enable CMS',
  'Price MSRP',
  'Price Maximum',
  'Price Minimum',
  'Price Original',
  'Franchise Price',
  'Emergency Price',
  'Allow Price Override',
  'Discount Cap %',
  'TAT Minimum',
  'TAT Minimum Unit',
  'TAT Maximum',
  'TAT Maximum Unit',
  'Schedule Days',
  'Scheduled Time From',
  'Scheduled Time To',
  'Processing Time Min',
  'Processing Time Min Unit',
  'Processing Time Max',
  'Processing Time Max Unit',
  'Approval Time Minimum',
  'Approval Time Minimum Unit',
  'Approval Time Maximum',
  'Approval Time Maximum Unit',
  'Reporting Time From',
  'Reporting Time To',
  'Bill Only Test',
  'Allow Discounts',
  'Outsource',
  'Preference Test',
  'Sample Flow',
  'Test Status',
  'Sample Name',
  'Sample Type',
  'Conatiner Type',
  'Sample Size',
  'collection method',
  'number of samples',
  'stability',
  'transport temperature',
  'preservative',
  'sample handling instructions',
  'fasting required',
  'light protection',
  'set as default',
  'Group Name',
  'Group Layout',
  'Group Settings',
  'Parameter Name',
  'Parameter Code',
  'Method',
  'reporting unit',
  'Result type',
  'parameter type',
  'NABL',
  'CAP',
  'result rounding type',
  'icon settings',
  'imgae settings',
  'reflex test',
  'calculation formula',
  'allowable units',
  'Notes',
  'REFERENCE RANGE',
  'Parameter Name',
  'Method',
  'GENDER',
  'AGE FROM',
  'AGE FROM UNIT',
  'AGE TO',
  'AGE TO UNIT',
  'LOWER LIMIT',
  'UPPER LIMIT',
  'CRITICAL MIN',
  'CRITICAL MAX',
  'DISPLAY OF REFERENCE RANGE',
  'ABNORMAL FLAG LOGIC',
  'REFERENCE VALUE',
  'Parameter Name',
  'Method',
  'GENDER',
  'AGE FROM',
  'AGE FROM UNIT',
  'AGE TO',
  'AGE TO UNIT',
  'DISPLAY OF REFERENCE VALUE',
  'ABNORMAL FLAG LOGIC',
  'USEFUL FOR',
  'INTERPRETATION OF RESULTS',
  'LIMITATIONS',
  'REMARKS',
  'REFERENCE',
  'VERSION',
  'EFFECTIVE FROM',
  'EFFECTIVE TO',
  'CHANGE REASON MODIFIED BY',
  'MODIFIED BY',
  'APPROVED BY',
] as const;

/** Column indexes (0-based) of the two literal section-label columns that
 * carry no data of their own ("REFERENCE RANGE" / "REFERENCE VALUE") —
 * included verbatim as empty columns to match the reference file exactly. */
export const REFERENCE_RANGE_LABEL_COL = 82; // 'REFERENCE RANGE'
export const REFERENCE_VALUE_LABEL_COL = 96; // 'REFERENCE VALUE'

/** Columns exported for round-trip fidelity but IGNORED on import (version
 * history is an audit trail managed elsewhere, never bulk-edited via Excel —
 * confirmed explicitly). */
export const VERSION_CONTROL_COLUMNS = [
  'VERSION',
  'EFFECTIVE FROM',
  'EFFECTIVE TO',
  'CHANGE REASON MODIFIED BY',
  'MODIFIED BY',
  'APPROVED BY',
] as const;

/** Fields that are Yes/No booleans. */
export const BOOLEAN_FIELDS = new Set<string>([
  'isMandatoryTest',
  'isRepeatIntervalRestriction',
  'isHideInOrderScreen',
  'isEnableCms',
  'isAllowPriceOverride',
  'isAllowDiscounts',
  'isPreferenceTest',
  'isFastingRequired',
  'isLightProtection',
  'isDefault',
  'isNabl',
  'isCap',
]);

/** Fields that are integers. */
export const INTEGER_FIELDS = new Set<string>([
  'priceMsrp',
  'priceMaximum',
  'priceMinimum',
  'priceOriginal',
  'franchisePrice',
  'emergencyPrice',
  'discountCapPct',
  'tatMinValue',
  'tatMaxValue',
  'procTimeMinValue',
  'procTimeMaxValue',
  'approvalDurationMinValue',
  'approvalDurationMaxValue',
  'repeatIntervalValue',
  'numberOfSamples',
  'ageFrom',
  'ageTo',
]);

/** Fields that are decimal numbers (not necessarily integral). */
export const NUMERIC_FIELDS = new Set<string>([
  'lowerLimit',
  'upperLimit',
  'criticalMin',
  'criticalMax',
]);

/** Semicolon-separated free-text-list fields (e.g. "Hormones; Thyroid"). */
export const SEMICOLON_LIST_FIELDS = new Set<string>([
  'clinicalTags',
  'scheduleDays',
]);

/** `Test Status` column: "Active"/"Inactive" ↔ `isActive` boolean. */
export const STATUS_LABEL_TO_ACTIVE: Record<string, boolean> = {
  Active: true,
  Inactive: false,
};

/** `Schedule Days` label ↔ `DayOfWeek` (CSV uses 3-letter abbreviations). */
export const DAY_LABEL_TO_ENUM: Record<string, DayOfWeek> = {
  Mon: 'MONDAY',
  Tue: 'TUESDAY',
  Wed: 'WEDNESDAY',
  Thu: 'THURSDAY',
  Fri: 'FRIDAY',
  Sat: 'SATURDAY',
  Sun: 'SUNDAY',
};
export const DAY_ENUM_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(DAY_LABEL_TO_ENUM).map(([label, value]) => [value, label]),
);

/**
 * Fields whose Excel value is a human display label, not a raw enum member.
 * Labels are fresh Title-Case text chosen for this new single-sheet design
 * (matching the reference CSV's own example values where it gives one, e.g.
 * "Single Step", "Routine", "Bold"), consistent between export and import.
 */
export const ENUM_LABEL_FIELDS: Record<string, Record<string, string>> = {
  processMethod: { 'Single Step': 'SINGLE_STEP', 'Multi Step': 'MULTI_STEP' },
  samplePriorityType: { Routine: 'ROUTINE', Urgent: 'URGENT', Stat: 'STAT' },
  tatMinUnit: { Minutes: 'MINUTES', Hours: 'HOURS', Days: 'DAYS' },
  tatMaxUnit: { Minutes: 'MINUTES', Hours: 'HOURS', Days: 'DAYS' },
  procTimeMinUnit: { Minutes: 'MINUTES', Hours: 'HOURS', Days: 'DAYS' },
  procTimeMaxUnit: { Minutes: 'MINUTES', Hours: 'HOURS', Days: 'DAYS' },
  approvalDurationMinUnit: { Minutes: 'MINUTES', Hours: 'HOURS', Days: 'DAYS' },
  approvalDurationMaxUnit: { Minutes: 'MINUTES', Hours: 'HOURS', Days: 'DAYS' },
  repeatIntervalUnit: {
    Hours: 'HOURS',
    Days: 'DAYS',
    Weeks: 'WEEKS',
    Months: 'MONTHS',
    Years: 'YEARS',
  },
  resultType: {
    Quantitative: 'QUANTITATIVE',
    Qualitative: 'QUALITATIVE',
    Calculated: 'CALCULATED',
  },
  parameterType: { Measured: 'MEASURED', Calculated: 'CALCULATED' },
  resultRoundingType: {
    'No Rounding': 'NO_ROUNDING',
    '1 Decimal': 'ONE_DECIMAL',
    '2 Decimal': 'TWO_DECIMAL',
    // CSV shows the misspelling "2 deicmal" as sample data — accept it as an
    // alias so the reference file itself round-trips cleanly.
    '2 Deicmal': 'TWO_DECIMAL',
    '3 Decimal': 'THREE_DECIMAL',
    'Whole Number': 'WHOLE_NUMBER',
  },
  gender: { All: 'ALL', Male: 'MALE', Female: 'FEMALE' },
  ageFromUnit: {
    Days: 'DAYS',
    Day: 'DAYS',
    Months: 'MONTHS',
    Month: 'MONTHS',
    Years: 'YEARS',
    Yrs: 'YEARS',
    Yr: 'YEARS',
  },
  ageToUnit: {
    Days: 'DAYS',
    Day: 'DAYS',
    Months: 'MONTHS',
    Month: 'MONTHS',
    Years: 'YEARS',
    Yrs: 'YEARS',
    Yr: 'YEARS',
  },
  abnormalFlagLogic: {
    'Bold And Red': 'BOLD_AND_RED',
    Bold: 'BOLD_ONLY',
    Italic: 'ITALIC',
    Underline: 'UNDERLINE',
    'Colour Highlight': 'COLOUR_HIGHLIGHT',
  },
  // Labels match the grid's generic `fmtEnum` (underscore→space, title-case),
  // e.g. `EDTA_TUBE_PURPLE_TOP` → "Edta Tube Purple Top" — the exact text
  // this sheet exports (see `fmtEnum`-style `titleCaseEnum` in
  // `lab-test.service.ts`).
  containerType: {
    'Edta Tube Purple Top': 'EDTA_TUBE_PURPLE_TOP',
    'Plain Tube Red Top': 'PLAIN_TUBE_RED_TOP',
    'Fluoride Tube Grey Top': 'FLUORIDE_TUBE_GREY_TOP',
    'Urine Container': 'URINE_CONTAINER',
    'Sterile Container': 'STERILE_CONTAINER',
  },
};

/**
 * Raw enum member (`SINGLE_STEP`) → the Excel display label a user actually
 * typed (`Single Step`) — the reverse of `ENUM_LABEL_FIELDS`, flattened
 * across all fields into one lookup (enum member names don't collide across
 * Prisma enums here). An `@IsEnum` failure's default class-validator message
 * lists valid values by their raw enum members (e.g. "must be one of the
 * following values: SINGLE_STEP, MULTI_STEP") — `LabTestService.
 * humanizeValidationMessage` uses this to show the labels the user actually
 * sees in the sheet instead.
 */
export const ENUM_VALUE_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(ENUM_LABEL_FIELDS).flatMap((labelToValue) =>
    Object.entries(labelToValue).map(([label, value]) => [value, label]),
  ),
);

/**
 * DTO field name → the Excel column header a user actually sees. Every
 * class-validator error is reported as `"<property> <constraint text>"`
 * (e.g. `"priceMsrp must be an integer number"`), and `<property>` is a raw
 * camelCase DTO field name a spreadsheet user has no way to map back to a
 * column — this dictionary is used (see
 * `LabTestService.humanizeValidationMessage`) to rewrite every occurrence of
 * the field name in an error message to its real header text before the
 * message reaches the user. Covers every field
 * on `ImportXlsxTestRowDto`/`ImportXlsxSampleRowDto`/
 * `ImportXlsxResultParamRowDto`/`ImportXlsxReferenceRangeRowDto`/
 * `ImportXlsxReferenceValueRowDto` that class-validator can report on
 * (`rowLabel` is import-only bookkeeping, never validated, so it's absent
 * here). A handful of column labels repeat across blocks (e.g. "Method",
 * "Parameter Name", "GENDER") — since the error text a user sees already
 * carries its own row context, the shared label is unambiguous enough.
 */
export const FIELD_TO_COLUMN_LABEL: Record<string, string> = {
  testName: 'Test Name',
  testDisplayName: 'Test Display Name',
  testCode: 'Test Code',
  aka: 'AKA(also known as)',
  departmentId: 'Department',
  categoryId: 'Category',
  subCategoryId: 'Sub Category',
  processMethod: 'Process Method',
  approvalWorkflowId: 'Approval Workflow',
  isMandatoryTest: 'Mandatory Test',
  mandatoryDeptId: 'Mandatory Department',
  isRepeatIntervalRestriction: 'Repeat Interval Restriction',
  repeatIntervalValue: 'Repeat Interval Value',
  repeatIntervalUnit: 'Repeat Interval Unit',
  isHideInOrderScreen: 'Hide in Order Screen',
  clinicalTags: 'Clinical Tags',
  icdCode: 'ICD Code',
  loincCode: 'LOINC Code',
  reportTemplateId: 'Report Template',
  samplePriorityType: 'Sample Priority Type',
  pdfSettingsId: 'PDF Settings',
  imageSettingsId: 'Image Settings',
  isEnableCms: 'Enable CMS',
  priceMsrp: 'Price MSRP',
  priceMaximum: 'Price Maximum',
  priceMinimum: 'Price Minimum',
  priceOriginal: 'Price Original',
  franchisePrice: 'Franchise Price',
  emergencyPrice: 'Emergency Price',
  isAllowPriceOverride: 'Allow Price Override',
  discountCapPct: 'Discount Cap %',
  tatMinValue: 'TAT Minimum',
  tatMinUnit: 'TAT Minimum Unit',
  tatMaxValue: 'TAT Maximum',
  tatMaxUnit: 'TAT Maximum Unit',
  scheduleDays: 'Schedule Days',
  scheduleFrom: 'Scheduled Time From',
  scheduleTo: 'Scheduled Time To',
  procTimeMinValue: 'Processing Time Min',
  procTimeMinUnit: 'Processing Time Min Unit',
  procTimeMaxValue: 'Processing Time Max',
  procTimeMaxUnit: 'Processing Time Max Unit',
  approvalDurationMinValue: 'Approval Time Minimum',
  approvalDurationMinUnit: 'Approval Time Minimum Unit',
  approvalDurationMaxValue: 'Approval Time Maximum',
  approvalDurationMaxUnit: 'Approval Time Maximum Unit',
  reportingTimeFrom: 'Reporting Time From',
  reportingTimeTo: 'Reporting Time To',
  isAllowDiscounts: 'Allow Discounts',
  isPreferenceTest: 'Preference Test',
  isActive: 'Test Status',
  usefulFor: 'USEFUL FOR',
  interpretationOfResults: 'INTERPRETATION OF RESULTS',
  limitations: 'LIMITATIONS',
  remarks: 'REMARKS',
  references: 'REFERENCE',
  samples: 'Sample block',
  resultParams: 'Result Parameter block',
  // Sample fields
  sampleNameId: 'Sample Name',
  sampleType: 'Sample Type',
  containerType: 'Conatiner Type',
  sampleSize: 'Sample Size',
  collectionMethod: 'collection method',
  numberOfSamples: 'number of samples',
  stability: 'stability',
  transportTemperature: 'transport temperature',
  preservative: 'preservative',
  sampleHandlingInstructions: 'sample handling instructions',
  isFastingRequired: 'fasting required',
  isLightProtection: 'light protection',
  isDefault: 'set as default',
  // Result Parameter fields
  groupName: 'Group Name',
  groupLayoutId: 'Group Layout',
  groupSettingsId: 'Group Settings',
  parameterName: 'Parameter Name',
  parameterCode: 'Parameter Code',
  method: 'Method',
  reportingUnit: 'reporting unit',
  resultType: 'Result type',
  parameterType: 'parameter type',
  isNabl: 'NABL',
  isCap: 'CAP',
  resultRoundingType: 'result rounding type',
  iconSettingsId: 'icon settings',
  reflexTestNames: 'reflex test',
  calculationFormula: 'calculation formula',
  allowableUnits: 'allowable units',
  notes: 'Notes',
  referenceRanges: 'Reference Range block',
  referenceValues: 'Reference Value block',
  // Reference Range/Value shared fields
  gender: 'GENDER',
  ageFrom: 'AGE FROM',
  ageFromUnit: 'AGE FROM UNIT',
  ageTo: 'AGE TO',
  ageToUnit: 'AGE TO UNIT',
  abnormalFlagLogic: 'ABNORMAL FLAG LOGIC',
  // Reference Range-only fields
  lowerLimit: 'LOWER LIMIT',
  upperLimit: 'UPPER LIMIT',
  criticalMin: 'CRITICAL MIN',
  criticalMax: 'CRITICAL MAX',
  displayOfReferenceRange: 'DISPLAY OF REFERENCE RANGE',
  // Reference Value-only field
  normalValueText: 'DISPLAY OF REFERENCE VALUE',
};
