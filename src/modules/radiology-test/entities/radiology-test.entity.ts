import {
  AbnormalFlag,
  ApprovalWorkflow,
  ContainerType,
  Prisma,
  ProcessMethod,
  RadiologyTest,
  RadiologyTestReferenceRange,
  RadiologyTestReferenceValue,
  RadiologyTestResultParam,
  RadiologyTestSample,
  ReferenceGender,
  ResultType,
  SamplePriority,
  TatUnit,
} from '@prisma/client';

/** Domain/response shape for a radiology test (the Prisma model is the DB source of truth). */
export type RadiologyTestEntity = RadiologyTest;

/** A reflex-test reference ({ id, name }) as stored/returned in the JSON column. */
export interface ReflexTestRef {
  id: string;
  name: string;
}

/**
 * A result parameter with its reference ranges and values attached. `reflexTests`
 * is the model's JSON column re-typed as `ReflexTestRef[]`.
 */
export type RadiologyTestResultParamWithRefs = Omit<
  RadiologyTestResultParam,
  'reflexTests'
> & {
  referenceRanges: RadiologyTestReferenceRange[];
  referenceValues: RadiologyTestReferenceValue[];
  reflexTests: ReflexTestRef[];
};

/** A radiology test composed with all of its child rows (the get-one response shape). */
export type RadiologyTestWithChildren = RadiologyTest & {
  samples: RadiologyTestSample[];
  resultParams: RadiologyTestResultParamWithRefs[];
};

/** One entry in a radiology test's `versionHistory` JSON array. */
export interface RadiologyTestVersionEntry {
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  modifiedBy: string | null;
  approvedBy: string | null;
}

// ── Listing API: views & per-view projection rows ─────────────────────────────

/** Column "views" for the radiology-test listing endpoint. */
export enum RadiologyTestListView {
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
export interface RadiologyTestDefaultRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  priceMsrp: number;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  defaultSample: RadiologyTestSample | null;
  parametersCount: number;
  isActive: boolean;
}

/** BASIC_DETAILS view. */
export interface RadiologyTestBasicDetailsRow {
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
export interface RadiologyTestPricingRow {
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
export interface RadiologyTestTatRow {
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
export interface RadiologyTestFlagsRow {
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
export interface RadiologyTestSampleRow {
  id: string;
  sampleNameId: string | null;
  sampleType: string | null;
  containerType: ContainerType | null;
  sampleSize: string | null;
  isFastingRequired: boolean;
  transportTemperature: string | null;
}

/** SAMPLE view. */
export interface RadiologyTestSampleViewRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  isActive: boolean;
  samples: RadiologyTestSampleRow[];
}

/** One result-parameter row inside the RESULTS view. */
export interface RadiologyTestResultsParamRow {
  id: string;
  parameterName: string;
  method: string | null;
  resultType: ResultType;
  units: string | null;
  isNabl: boolean;
  isCap: boolean;
}

/** RESULTS view. */
export interface RadiologyTestResultsRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  isActive: boolean;
  resultParams: RadiologyTestResultsParamRow[];
}

/** One reference-range row. */
export interface RadiologyTestRefRangeRow {
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
export interface RadiologyTestReferenceRangeRow {
  id: string;
  testName: string;
  testCode: string;
  referenceRanges: RadiologyTestRefRangeRow[];
}

/** One reference-value row. */
export interface RadiologyTestRefValueRow {
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
export interface RadiologyTestReferenceValueRow {
  id: string;
  testName: string;
  testCode: string;
  referenceValues: RadiologyTestRefValueRow[];
}

/** NOTES view. */
export interface RadiologyTestNotesRow {
  id: string;
  testName: string;
  usefulFor: string | null;
  interpretationOfResults: string | null;
  limitations: string | null;
  remarks: string | null;
  references: string | null;
}

/** VERSION_CONTROL view. */
export interface RadiologyTestVersionControlRow {
  id: string;
  testName: string;
  currentVersion: number | null;
  effectiveFrom: string | null;
  modifiedBy: string | null;
  versionHistory: RadiologyTestVersionEntry[];
}

/** OVERVIEW view. */
export interface RadiologyTestOverviewRow {
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
export type RadiologyTestListRow =
  | RadiologyTestDefaultRow
  | RadiologyTestBasicDetailsRow
  | RadiologyTestPricingRow
  | RadiologyTestTatRow
  | RadiologyTestFlagsRow
  | RadiologyTestSampleViewRow
  | RadiologyTestResultsRow
  | RadiologyTestReferenceRangeRow
  | RadiologyTestReferenceValueRow
  | RadiologyTestNotesRow
  | RadiologyTestVersionControlRow
  | RadiologyTestOverviewRow;

/**
 * A SITE_ADMIN template row for the tenant's import picker: any listing view row
 * plus `isImported`.
 */
export type ImportableTemplateRow = RadiologyTestListRow & {
  isImported: boolean;
};

/** Per-template outcome of a bulk import/sync operation. */
export interface RadiologyTestImportOutcome {
  templateId: string;
  testId?: string;
  testName?: string;
  reason?: string;
}

/** Summary returned by `POST /radiology-tests/import`. */
export interface RadiologyTestImportResult {
  imported: RadiologyTestImportOutcome[];
  skipped: RadiologyTestImportOutcome[];
  failed: RadiologyTestImportOutcome[];
}

/** Per-test outcome of a bulk sync operation. */
export interface RadiologyTestSyncOutcome {
  testId: string;
  testName?: string;
  templateId?: string;
  reason?: string;
}

/** Summary returned by `POST /radiology-tests/sync`. */
export interface RadiologyTestSyncResult {
  synced: RadiologyTestSyncOutcome[];
  skipped: RadiologyTestSyncOutcome[];
  failed: RadiologyTestSyncOutcome[];
}
