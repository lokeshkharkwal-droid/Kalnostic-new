import {
  AbnormalFlag,
  ContainerType,
  LabTest,
  LabTestReferenceRange,
  LabTestReferenceValue,
  LabTestResultParam,
  LabTestSample,
  Prisma,
  ProcessMethod,
  ReferenceGender,
  ResultType,
  SamplePriority,
  TatUnit,
} from '@prisma/client';

/** Domain/response shape for a lab test (the Prisma model is the DB source of truth). */
export type LabTestEntity = LabTest;

/** A reflex-test reference ({ id, name }) as stored/returned in the JSON column. */
export interface ReflexTestRef {
  id: string;
  name: string;
}

/**
 * A result parameter with its reference ranges and values attached. `reflexTests`
 * is the model's JSON column re-typed as `ReflexTestRef[]` (Prisma types JSON
 * columns as `JsonValue`).
 */
export type LabTestResultParamWithRefs = Omit<
  LabTestResultParam,
  'reflexTests'
> & {
  referenceRanges: LabTestReferenceRange[];
  referenceValues: LabTestReferenceValue[];
  reflexTests: ReflexTestRef[];
};

/** A lab test composed with all of its child rows (the get-one response shape). */
export type LabTestWithChildren = LabTest & {
  samples: LabTestSample[];
  resultParams: LabTestResultParamWithRefs[];
};

/** One entry in a lab test's `versionHistory` JSON array. */
export interface LabTestVersionEntry {
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  modifiedBy: string | null;
  approvedBy: string | null;
}

// ── Listing API: views & per-view projection rows ─────────────────────────────

/**
 * Column "views" for the lab-test listing endpoint. Each value projects a
 * different subset of fields (and, for the child-centric views, nested arrays).
 */
export enum LabTestListView {
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

/** DEFAULT view: identity + headline price/TAT, default sample, parameter count. */
export interface LabTestDefaultRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  priceMsrp: number;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  defaultSample: LabTestSample | null;
  parametersCount: number;
  isActive: boolean;
}

/** BASIC_DETAILS view: identity + resolved classification names + config. */
export interface LabTestBasicDetailsRow {
  id: string;
  testName: string;
  testCode: string;
  aka: string | null;
  departmentName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  processMethod: ProcessMethod;
  /** "Approval" — logical ref to a (not-yet-built) approval-workflow module. */
  approvalWorkflowId: string | null;
  isMandatoryTest: boolean;
  samplePriorityType: SamplePriority;
  icdCode: string | null;
  loincCode: string | null;
}

/** PRICING view: the full price ladder. */
export interface LabTestPricingRow {
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

/** TAT view: turnaround, schedule, processing, and approval windows. */
export interface LabTestTatRow {
  id: string;
  testName: string;
  tatMinValue: number | null;
  tatMinUnit: TatUnit | null;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  scheduleFrom: string | null;
  scheduleTo: string | null;
  procTimeMinValue: number | null;
  procTimeMinUnit: TatUnit | null;
  procTimeMaxValue: number | null;
  procTimeMaxUnit: TatUnit | null;
  approvalTimeFrom: string | null;
  approvalTimeTo: string | null;
}

/** FLAGS view: the boolean flags that exist on the model today. */
export interface LabTestFlagsRow {
  id: string;
  testName: string;
  isHideInOrderScreen: boolean;
  isEnableCms: boolean;
  /** "Reference test" maps to the preference-test flag. */
  isPreferenceTest: boolean;
  isActive: boolean;
}

/** One sample row inside the SAMPLE view. */
export interface LabTestSampleRow {
  id: string;
  sampleNameId: string | null;
  sampleType: string | null;
  containerType: ContainerType | null;
  sampleSize: string | null;
  isFastingRequired: boolean;
  transportTemperature: string | null;
}

/** SAMPLE view: one test with its (nested) samples. */
export interface LabTestSampleViewRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  isActive: boolean;
  samples: LabTestSampleRow[];
}

/** One result-parameter row inside the RESULTS view. */
export interface LabTestResultsParamRow {
  id: string;
  parameterName: string;
  method: string | null;
  resultType: ResultType;
  units: string | null;
  isNabl: boolean;
  isCap: boolean;
}

/** RESULTS view: one test with its (nested) result parameters. */
export interface LabTestResultsRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  isActive: boolean;
  resultParams: LabTestResultsParamRow[];
}

/** One reference-range row (parameter name/method denormalised in). */
export interface LabTestRefRangeRow {
  id: string;
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

/** REFERENCE_RANGE view: one test with its (nested) reference ranges. */
export interface LabTestReferenceRangeRow {
  id: string;
  testName: string;
  testCode: string;
  referenceRanges: LabTestRefRangeRow[];
}

/** One reference-value row (parameter name/method denormalised in). */
export interface LabTestRefValueRow {
  id: string;
  parameterName: string;
  method: string | null;
  gender: ReferenceGender;
  ageFrom: number;
  ageTo: number;
  displayValue: string;
  flag: AbnormalFlag;
}

/** REFERENCE_VALUE view: one test with its (nested) reference values. */
export interface LabTestReferenceValueRow {
  id: string;
  testName: string;
  testCode: string;
  referenceValues: LabTestRefValueRow[];
}

/** NOTES view: the free-text documentation fields. */
export interface LabTestNotesRow {
  id: string;
  testName: string;
  usefulFor: string | null;
  interpretationOfResults: string | null;
  limitations: string | null;
  remarks: string | null;
  references: string | null;
}

/** VERSION_CONTROL view: current version summary + full history. */
export interface LabTestVersionControlRow {
  id: string;
  testName: string;
  currentVersion: number | null;
  effectiveFrom: string | null;
  modifiedBy: string | null;
  versionHistory: LabTestVersionEntry[];
}

/** OVERVIEW view: a compact at-a-glance summary with child counts. */
export interface LabTestOverviewRow {
  id: string;
  testName: string;
  testCode: string;
  departmentName: string | null;
  /** "Max value" — interpreted as the maximum price. */
  maxValue: number;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  samplesCount: number;
  parametersCount: number;
  isActive: boolean;
}

/** Union of every per-view row shape returned by the listing endpoint. */
export type LabTestListRow =
  | LabTestDefaultRow
  | LabTestBasicDetailsRow
  | LabTestPricingRow
  | LabTestTatRow
  | LabTestFlagsRow
  | LabTestSampleViewRow
  | LabTestResultsRow
  | LabTestReferenceRangeRow
  | LabTestReferenceValueRow
  | LabTestNotesRow
  | LabTestVersionControlRow
  | LabTestOverviewRow;
