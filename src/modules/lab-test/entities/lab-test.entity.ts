import {
  AbnormalFlag,
  ApprovalWorkflow,
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
  approvalWorkflow: ApprovalWorkflow | null;
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

/** FLAGS view: the boolean flags that exist on the model today. */
export interface LabTestFlagsRow {
  id: string;
  testName: string;
  isHideInOrderScreen: boolean;
  isEnableCms: boolean;
  /** "Reference test" maps to the preference-test flag. */
  isPreferenceTest: boolean;
  isOutsource: boolean;
  isBillOnlyTest: boolean;
  isSampleFlow: boolean;
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
  /** The owning result parameter's id — not shown on screen, used for import matching. */
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
  /** The owning result parameter's id — not shown on screen, used for import matching. */
  paramId: string;
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

/**
 * A SITE_ADMIN template row for the tenant's import picker: any listing view row
 * plus `isImported` — true when the tenant already imported this template into
 * the target master data (see `LabTestService.findAllTemplates`).
 */
export type ImportableTemplateRow = LabTestListRow & { isImported: boolean };

/** Per-template outcome of a bulk import/sync operation. */
export interface LabTestImportOutcome {
  /** The SITE_ADMIN template id acted on. */
  templateId: string;
  /** The resulting tenant lab-test id (present on success). */
  labTestId?: string;
  testName?: string;
  /** Reason for a skip/failure (absent on success). */
  reason?: string;
}

/** Summary returned by `POST /lab-tests/import`. */
export interface LabTestImportResult {
  imported: LabTestImportOutcome[];
  skipped: LabTestImportOutcome[];
  failed: LabTestImportOutcome[];
}

/** Per-test outcome of a bulk sync operation. */
export interface LabTestSyncOutcome {
  /** The tenant lab-test id acted on. */
  labTestId: string;
  testName?: string;
  /** The SITE_ADMIN template it was synced from. */
  templateId?: string;
  /** Reason for a skip/failure (absent on success). */
  reason?: string;
}

/** Summary returned by `POST /lab-tests/sync`. */
export interface LabTestSyncResult {
  synced: LabTestSyncOutcome[];
  skipped: LabTestSyncOutcome[];
  failed: LabTestSyncOutcome[];
}

// ── Excel export/import ────────────────────────────────────────────────────

/** A result parameter composed with its reference ranges/values, for the
 * flat single-sheet export (reflex tests flattened to a name list — see
 * `reflexTestNames`, export-only/informational on import). */
export type LabTestExportParam = Omit<LabTestResultParam, 'reflexTests'> & {
  reflexTestNames: string;
  referenceRanges: LabTestReferenceRange[];
  referenceValues: LabTestReferenceValue[];
};

/**
 * One fully-composed lab test for the flat single-sheet export: every
 * scalar field plus resolved classification names, its samples, and its
 * result parameters (each carrying nested reference ranges/values). This is
 * the ONLY shape the export endpoint returns now — the frontend's
 * `buildLabTestWorkbook` walks each test's `samples`/`resultParams` directly
 * to lay out the row-expansion pattern (see `labTestExcel.ts`); there are no
 * more per-grid-tab "views" projections.
 */
export type LabTestExportTest = LabTest & {
  departmentName: string | null;
  /** Resolved name of `mandatoryDeptId` — the "Mandatory for  Department" xlsx column. */
  mandatoryDeptName: string | null;
  /** Resolved name of `mandatoryCatId` — the "Mandatory for Category" xlsx column. */
  mandatoryCatName: string | null;
  /** Resolved name of `mandatorySubcatId` — the "Mandatory for Sub-Category" xlsx column. */
  mandatorySubcatName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  samples: LabTestSample[];
  resultParams: LabTestExportParam[];
};

/** Full unpaginated snapshot of a master data's lab tests, returned by the export endpoint. */
export interface LabTestExportPayload {
  tests: LabTestExportTest[];
}

/** One reason a test's row-span was skipped. `column` is the exact Excel
 * column label (e.g. "Price MSRP", "Mandatory for Category") when the error
 * is attributable to one column; omitted for cross-field/structural errors
 * (e.g. "at least one sample is required") that don't name a single column. */
export interface ImportXlsxSkippedError {
  column?: string;
  message: string;
}

/** One test's row-span that failed validation and was skipped (not saved). */
export interface ImportXlsxSkippedTest {
  /** e.g. "Row 3" or "Rows 3-8" — the failed test's row-span in the sheet. */
  rowLabel: string;
  /** Every reason this specific test was skipped. */
  errors: ImportXlsxSkippedError[];
}

/**
 * Result of an Excel import: how many lab tests were created/updated, and
 * which ones (if any) were skipped for failing validation. Partial import —
 * every test in the file is validated independently; a test with an error
 * is skipped and reported in `skipped`, but every other valid test in the
 * same file is still created/updated. `skipped` is empty on a fully clean
 * import.
 */
/** One Department/Category/Sub-Category name that appeared somewhere in the
 * uploaded file but doesn't match any existing tenant record — grouped once
 * per distinct (column, name) pair, not repeated per row, so the user gets
 * one upfront list of everything to create before re-uploading, instead of
 * discovering each one only after fixing the last. */
export interface ImportXlsxUnresolvedClassification {
  /** The exact Excel column this name appeared in, e.g. "Department",
   * "Mandatory for Category". */
  column: string;
  /** The exact text typed in the sheet (not normalized), so the user can see
   * precisely what they wrote. */
  name: string;
}

export interface ImportXlsxResult {
  created: number;
  updated: number;
  skipped: ImportXlsxSkippedTest[];
  /** Every distinct Department/Category/Sub-Category name referenced in the
   * file that doesn't exist yet, deduplicated across the whole file. Empty
   * when every classification name in the file resolved successfully. */
  unresolvedClassifications: ImportXlsxUnresolvedClassification[];
}
