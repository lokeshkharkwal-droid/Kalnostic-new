import { RadiologyPanel, RadiologyPanelTest } from '@prisma/client';

/** Domain/response shape for a radiology panel (the Prisma model is the DB source of truth). */
export type RadiologyPanelEntity = RadiologyPanel;

/** A resolved classification reference (category/department) embedded in panel reads. */
export interface ClassificationRef {
  id: string;
  name: string;
}

/**
 * A full radiology panel enriched with its resolved `category`/`department`
 * objects (`null` when the panel has no category/department). The base read shape
 * used by every panel-returning endpoint.
 */
export type RadiologyPanelWithRefs = RadiologyPanel & {
  category: ClassificationRef | null;
  department: ClassificationRef | null;
};

/**
 * One included test, enriched with the referenced `RadiologyTest`'s display/
 * pricing details (name, code, modality, price ladder, discount cap) so the
 * get-one response is self-contained — the caller never needs a second lookup to
 * render the panel's test table. `radiologyTestId` is a logical reference (no
 * Prisma relation, see `RadiologyPanelTest`'s schema comment), so these fields
 * fall back to `null` if the referenced test was hard-deleted or is otherwise
 * unresolvable (soft-deleted tests still resolve normally).
 */
export type RadiologyPanelTestWithDetails = RadiologyPanelTest & {
  testName: string | null;
  testCode: string | null;
  modality: string | null;
  priceMsrp: number | null;
  priceOriginal: number | null;
  priceMinimum: number | null;
  priceMaximum: number | null;
  discountCapPct: number | null;
};

/** A radiology panel (with refs) composed with its included tests (the get-one response shape). */
export type RadiologyPanelWithTests = RadiologyPanelWithRefs & {
  tests: RadiologyPanelTestWithDetails[];
};

/**
 * One row of the radiology-panel listing endpoint: the full panel record enriched
 * with its `category`/`department` objects, plus the count of included tests.
 */
export type RadiologyPanelListRow = RadiologyPanelWithRefs & {
  testsCount: number;
};

/**
 * A SITE_ADMIN template row for the tenant's import picker: a listing row plus
 * `isImported` — true when the tenant already imported this template into the
 * target master data (see `RadiologyPanelService.findAllTemplates`).
 */
export type ImportableRadiologyPanelTemplateRow = RadiologyPanelListRow & {
  isImported: boolean;
};

/** Result of a clone-all operation: how many panels were copied vs skipped. */
export interface RadiologyPanelCloneResult {
  copied: number;
  skipped: number;
}

/** Per-template outcome of a bulk import operation. */
export interface RadiologyPanelImportOutcome {
  /** The SITE_ADMIN template id acted on. */
  templateId: string;
  /** The resulting tenant radiology-panel id (present on success). */
  radiologyPanelId?: string;
  panelName?: string;
  /** Reason for a skip/failure (absent on success). */
  reason?: string;
}

/** Summary returned by `POST /radiology-panels/import`. */
export interface RadiologyPanelImportResult {
  imported: RadiologyPanelImportOutcome[];
  skipped: RadiologyPanelImportOutcome[];
  failed: RadiologyPanelImportOutcome[];
}

/** Per-panel outcome of a bulk sync operation. */
export interface RadiologyPanelSyncOutcome {
  /** The tenant radiology-panel id acted on. */
  radiologyPanelId: string;
  panelName?: string;
  /** The SITE_ADMIN template it was synced from. */
  templateId?: string;
  /** Reason for a skip/failure (absent on success). */
  reason?: string;
}

/** Summary returned by `POST /radiology-panels/sync`. */
export interface RadiologyPanelSyncResult {
  synced: RadiologyPanelSyncOutcome[];
  skipped: RadiologyPanelSyncOutcome[];
  failed: RadiologyPanelSyncOutcome[];
}
