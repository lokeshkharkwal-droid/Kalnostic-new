import {
  AbnormalFlag,
  ApprovalWorkflow,
  ContainerType,
  Prisma,
  ProcessMethod,
  OpdTest,
  OpdTestReferenceRange,
  OpdTestReferenceValue,
  OpdTestResultParam,
  OpdTestSample,
  ReferenceGender,
  ResultType,
  SamplePriority,
  TatUnit,
} from '@prisma/client';

/** Domain/response shape for a opd test (the Prisma model is the DB source of truth). */
export type OpdTestEntity = OpdTest;

/** A reflex-test reference ({ id, name }) as stored/returned in the JSON column. */
export interface ReflexTestRef {
  id: string;
  name: string;
}

/**
 * A result parameter with its reference ranges and values attached. `reflexTests`
 * is the model's JSON column re-typed as `ReflexTestRef[]`.
 */
export type OpdTestResultParamWithRefs = Omit<
  OpdTestResultParam,
  'reflexTests'
> & {
  referenceRanges: OpdTestReferenceRange[];
  referenceValues: OpdTestReferenceValue[];
  reflexTests: ReflexTestRef[];
};

/** A opd test composed with all of its child rows (the get-one response shape). */
export type OpdTestWithChildren = OpdTest & {
  samples: OpdTestSample[];
  resultParams: OpdTestResultParamWithRefs[];
};

/** One entry in a opd test's `versionHistory` JSON array. */
export interface OpdTestVersionEntry {
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  modifiedBy: string | null;
  approvedBy: string | null;
}

// ── Listing API: views & per-view projection rows ─────────────────────────────

/** Column "views" for the opd-test listing endpoint. */
export enum OpdTestListView {
  DEFAULT = 'DEFAULT',
  BASIC_DETAILS = 'BASIC_DETAILS',
  PRICING = 'PRICING',
  TAT = 'TAT',
  FLAGS = 'FLAGS',
  SAMPLE = 'SAMPLE',
  RESULTS = 'RESULTS',
  REFERENCE_RANGE = 'REFERENCE_RANGE',
  REFERENCE_VALUE = 'REFERENCE_VALUE',
  NOTES = 'NOTES',
  VERSION_CONTROL = 'VERSION_CONTROL',
  OVERVIEW = 'OVERVIEW',
}

/** DEFAULT view. */
export interface OpdTestDefaultRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  priceMsrp: number;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  defaultSample: OpdTestSample | null;
  parametersCount: number;
  isActive: boolean;
}

/** BASIC_DETAILS view. */
export interface OpdTestBasicDetailsRow {
  id: string;
  testName: string;
  testCode: string;
  aka: string | null;
  departmentName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  processMethod: ProcessMethod;
  approvalWorkflow: ApprovalWorkflow | null;
  isMandatoryTest: boolean;
  samplePriorityType: SamplePriority;
  icdCode: string | null;
  loincCode: string | null;
}

/** PRICING view. */
export interface OpdTestPricingRow {
  id: string;
  testName: string;
  testCode: string;
  priceMsrp: number;
  priceMinimum: number;
  priceMaximum: number;
  priceOriginal: number;
  franchisePrice: number;
  emergencyPrice: number;
  discountCapPct: number;
  isAllowPriceOverride: boolean;
  isAllowDiscounts: boolean;
}

/** TAT view. */
export interface OpdTestTatRow {
  id: string;
  testName: string;
  tatMinValue: number | null;
  tatMinUnit: TatUnit | null;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  scheduleFrom: string | null;
  scheduleTo: string | null;
  processingTimeFrom: string | null;
  processingTimeTo: string | null;
  procTimeMinValue: number | null;
  procTimeMinUnit: TatUnit | null;
  procTimeMaxValue: number | null;
  procTimeMaxUnit: TatUnit | null;
  approvalTimeFrom: string | null;
  approvalTimeTo: string | null;
  reportingTimeFrom: string | null;
  reportingTimeTo: string | null;
  approvalDurationMinValue: number | null;
  approvalDurationMinUnit: TatUnit | null;
  approvalDurationMaxValue: number | null;
  approvalDurationMaxUnit: TatUnit | null;
}

/** FLAGS view. */
export interface OpdTestFlagsRow {
  id: string;
  testName: string;
  isHideInOrderScreen: boolean;
  isEnableCms: boolean;
  isPreferenceTest: boolean;
  isOutsource: boolean;
  isBillOnlyTest: boolean;
  isSampleFlow: boolean;
  isActive: boolean;
}

/** One sample row inside the SAMPLE view. */
export interface OpdTestSampleRow {
  id: string;
  sampleNameId: string | null;
  sampleType: string | null;
  containerType: ContainerType | null;
  sampleSize: string | null;
  isFastingRequired: boolean;
  transportTemperature: string | null;
}

/** SAMPLE view. */
export interface OpdTestSampleViewRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  isActive: boolean;
  samples: OpdTestSampleRow[];
}

/** One result-parameter row inside the RESULTS view. */
export interface OpdTestResultsParamRow {
  id: string;
  parameterName: string;
  method: string | null;
  resultType: ResultType;
  units: string | null;
  isNabl: boolean;
  isCap: boolean;
}

/** RESULTS view. */
export interface OpdTestResultsRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  isActive: boolean;
  resultParams: OpdTestResultsParamRow[];
}

/** One reference-range row. */
export interface OpdTestRefRangeRow {
  id: string;
  paramId: string;
  parameterName: string;
  method: string | null;
  gender: ReferenceGender;
  ageFrom: number;
  ageTo: number;
  lowerLimit: Prisma.Decimal | null;
  upperLimit: Prisma.Decimal | null;
  displayOfReferenceRange: string | null;
  flag: AbnormalFlag;
}

/** REFERENCE_RANGE view. */
export interface OpdTestReferenceRangeRow {
  id: string;
  testName: string;
  testCode: string;
  referenceRanges: OpdTestRefRangeRow[];
}

/** One reference-value row. */
export interface OpdTestRefValueRow {
  id: string;
  paramId: string;
  parameterName: string;
  method: string | null;
  gender: ReferenceGender;
  ageFrom: number;
  ageTo: number;
  displayValue: string;
  flag: AbnormalFlag;
}

/** REFERENCE_VALUE view. */
export interface OpdTestReferenceValueRow {
  id: string;
  testName: string;
  testCode: string;
  referenceValues: OpdTestRefValueRow[];
}

/** NOTES view. */
export interface OpdTestNotesRow {
  id: string;
  testName: string;
  usefulFor: string | null;
  interpretationOfResults: string | null;
  limitations: string | null;
  remarks: string | null;
  references: string | null;
}

/** VERSION_CONTROL view. */
export interface OpdTestVersionControlRow {
  id: string;
  testName: string;
  currentVersion: number | null;
  effectiveFrom: string | null;
  modifiedBy: string | null;
  versionHistory: OpdTestVersionEntry[];
}

/** OVERVIEW view. */
export interface OpdTestOverviewRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  maxValue: number;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  samplesCount: number;
  parametersCount: number;
  isActive: boolean;
}

/** Union of every per-view row shape returned by the listing endpoint. */
export type OpdTestListRow =
  | OpdTestDefaultRow
  | OpdTestBasicDetailsRow
  | OpdTestPricingRow
  | OpdTestTatRow
  | OpdTestFlagsRow
  | OpdTestSampleViewRow
  | OpdTestResultsRow
  | OpdTestReferenceRangeRow
  | OpdTestReferenceValueRow
  | OpdTestNotesRow
  | OpdTestVersionControlRow
  | OpdTestOverviewRow;

/**
 * A SITE_ADMIN template row for the tenant's import picker: any listing view row
 * plus `isImported`.
 */
export type ImportableTemplateRow = OpdTestListRow & {
  isImported: boolean;
};

/** Per-template outcome of a bulk import/sync operation. */
export interface OpdTestImportOutcome {
  templateId: string;
  labTestId?: string;
  testName?: string;
  reason?: string;
}

/** Summary returned by `POST /opd-tests/import`. */
export interface OpdTestImportResult {
  imported: OpdTestImportOutcome[];
  skipped: OpdTestImportOutcome[];
  failed: OpdTestImportOutcome[];
}

/** Per-test outcome of a bulk sync operation. */
export interface OpdTestSyncOutcome {
  labTestId: string;
  testName?: string;
  templateId?: string;
  reason?: string;
}

/** Summary returned by `POST /opd-tests/sync`. */
export interface OpdTestSyncResult {
  synced: OpdTestSyncOutcome[];
  skipped: OpdTestSyncOutcome[];
  failed: OpdTestSyncOutcome[];
}
