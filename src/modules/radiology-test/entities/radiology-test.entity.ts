import { RadiologyModality, RadiologyTest, TatUnit } from '@prisma/client';

/**
 * Domain/response shape for a radiology test (the Prisma model is the DB source
 * of truth). The radiology model is FLAT — a single row with identity, modality/
 * body-part/view, classification, pricing, TAT, schedule, flags and notes — so,
 * unlike {@link LabTestWithChildren}, there are no nested samples/result
 * parameters/reference ranges to compose.
 */
export type RadiologyTestEntity = RadiologyTest;

/** One entry in a radiology test's `versionHistory` JSON array. */
export interface RadiologyTestVersionEntry {
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  modifiedBy: string | null;
  approvedBy: string | null;
}

// ── Listing API: views & per-view projection rows ─────────────────────────────

/**
 * Column "views" for the radiology-test listing endpoint. Each value projects a
 * different subset of fields. The flat model has no child-centric views (no
 * samples/results/reference ranges).
 */
export enum RadiologyTestListView {
  DEFAULT = 'DEFAULT',
  BASIC_DETAILS = 'BASIC_DETAILS',
  PRICING = 'PRICING',
  TAT = 'TAT',
  FLAGS = 'FLAGS',
  NOTES = 'NOTES',
  OVERVIEW = 'OVERVIEW',
}

/** DEFAULT view: identity + modality + headline price/TAT. */
export interface RadiologyTestDefaultRow {
  id: string;
  testName: string;
  testCode: string;
  modality: RadiologyModality;
  bodyPart: string | null;
  departmentName: string | null;
  priceMsrp: number;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  isActive: boolean;
}

/** BASIC_DETAILS view: identity + resolved classification names + radiology config. */
export interface RadiologyTestBasicDetailsRow {
  id: string;
  testName: string;
  testCode: string;
  aka: string | null;
  modality: RadiologyModality;
  bodyPart: string | null;
  view: string | null;
  isContrast: boolean;
  departmentName: string | null;
  categoryName: string | null;
  subCategoryName: string | null;
  icdCode: string | null;
  loincCode: string | null;
}

/** PRICING view: the full price ladder. */
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

/** TAT view: turnaround and schedule windows. */
export interface RadiologyTestTatRow {
  id: string;
  testName: string;
  tatMinValue: number | null;
  tatMinUnit: TatUnit | null;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  scheduleFrom: string | null;
  scheduleTo: string | null;
}

/** FLAGS view: the boolean flags that exist on the model today. */
export interface RadiologyTestFlagsRow {
  id: string;
  testName: string;
  isHideInOrderScreen: boolean;
  isEnableCms: boolean;
  isPreferenceTest: boolean;
  isOutsource: boolean;
  isBillOnlyTest: boolean;
  isActive: boolean;
}

/** NOTES view: the free-text documentation fields. */
export interface RadiologyTestNotesRow {
  id: string;
  testName: string;
  usefulFor: string | null;
  interpretationOfResults: string | null;
  limitations: string | null;
  remarks: string | null;
  references: string | null;
  preparationInstructions: string | null;
}

/** OVERVIEW view: a compact at-a-glance summary. */
export interface RadiologyTestOverviewRow {
  id: string;
  testName: string;
  testCode: string;
  modality: RadiologyModality;
  departmentName: string | null;
  /** "Max value" — interpreted as the maximum price. */
  maxValue: number;
  tatMaxValue: number | null;
  tatMaxUnit: TatUnit | null;
  isActive: boolean;
}

/** Union of every per-view row shape returned by the listing endpoint. */
export type RadiologyTestListRow =
  | RadiologyTestDefaultRow
  | RadiologyTestBasicDetailsRow
  | RadiologyTestPricingRow
  | RadiologyTestTatRow
  | RadiologyTestFlagsRow
  | RadiologyTestNotesRow
  | RadiologyTestOverviewRow;

/**
 * A SITE_ADMIN template row for the tenant's import picker: any listing view row
 * plus `isImported` — true when the tenant already imported this template into
 * the target master data (see `RadiologyTestService.findAllTemplates`).
 */
export type ImportableRadiologyTemplateRow = RadiologyTestListRow & {
  isImported: boolean;
};

/** Result of a clone operation: how many tests were copied vs skipped. */
export interface RadiologyTestCloneResult {
  copied: number;
  skipped: number;
}

/** Per-template outcome of a bulk import/sync operation. */
export interface RadiologyTestImportOutcome {
  /** The SITE_ADMIN template id acted on. */
  templateId: string;
  /** The resulting tenant radiology-test id (present on success). */
  radiologyTestId?: string;
  testName?: string;
  /** Reason for a skip/failure (absent on success). */
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
  /** The tenant radiology-test id acted on. */
  radiologyTestId: string;
  testName?: string;
  /** The SITE_ADMIN template it was synced from. */
  templateId?: string;
  /** Reason for a skip/failure (absent on success). */
  reason?: string;
}

/** Summary returned by `POST /radiology-tests/sync`. */
export interface RadiologyTestSyncResult {
  synced: RadiologyTestSyncOutcome[];
  skipped: RadiologyTestSyncOutcome[];
  failed: RadiologyTestSyncOutcome[];
}
