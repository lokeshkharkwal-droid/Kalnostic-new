import {
  AgeType,
  BillingType,
  Gender,
  LabReportStatus,
  MultiStepProcessType,
  MultiStepStage,
  ParameterType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ResultType,
  SampleStatus,
  TatBand,
} from '@prisma/client';
import type { NoteSectionKey } from '../utils/note-sections.util';

/**
 * Compact Analytical-TAT figure attached to each worklist row (SRS §6.2/§8).
 * `isFinal` reports are the frozen `LabReport.tat*` snapshot; in-flight rows are
 * computed live against "now". `computable=false` when there's no accepted
 * sample or no active branch schedule to measure against.
 */
export interface WorklistTat {
  band: TatBand | null;
  netMinutes: number | null;
  /** The test/panel's configured Max TAT (minutes) — lets the frontend derive
   * remaining time (`maxTatMinutes - netMinutes`) without a second call. */
  maxTatMinutes: number | null;
  isFinal: boolean;
  computable: boolean;
}

/** Relations eager-loaded when fetching a report's full detail (Test Entry screen). */
export const LAB_REPORT_DETAIL_INCLUDE = {
  resultValues: { where: { deletedAt: null } },
  notes: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
  attachments: { where: { deletedAt: null }, orderBy: { uploadedAt: 'desc' } },
  multiStepProcess: { where: { deletedAt: null } },
  orderItem: {
    include: {
      order: {
        include: { patient: true, referredByDoctor: true, referralPanel: true },
      },
      branchLabTest: true,
      branchLabPanel: true,
    },
  },
  // the entry the holding branch works with, when it is not the order line's own
  performingEntry: true,
} satisfies Prisma.LabReportInclude;

/** A report with its result values, notes, attachments, and order context. */
export type LabReportDetail = Prisma.LabReportGetPayload<{
  include: typeof LAB_REPORT_DETAIL_INCLUDE;
}>;

/**
 * The Test Entry screen's content sections (LABORATORY.docx §4.5): Useful
 * For / Interpretation / Limitations / Remarks / References. Each field
 * resolves as `LabReport`'s own column ?? the linked `LabTest`'s configured
 * default (via `LabReport.labTestId` — a logical ref, no Prisma relation, so
 * this is resolved with a separate query rather than an `include`). A report
 * with no edits of its own here shows the test's defaults; editing a field
 * (`updateContentSections`) writes to THIS report only, never back to
 * `LabTest` — the shared master is never mutated by a technician's edit. All
 * null when the report has no linked `LabTest` at all (a panel item, a
 * direct/free-text entry, or a branch-only test with no tenant catalogue
 * source) AND no override was ever saved on the report itself.
 */
export interface LabReportContentSections {
  usefulFor: string | null;
  interpretation: string | null;
  limitations: string | null;
  remarks: string | null;
  references: string | null;
}

/**
 * Which Notes sections print on this report, as the Test Entry / Report View
 * screens need to show it. Resolved on the server so the screen never has to
 * work out which Branch Setting applies (the Lab Panel switch for a report on
 * a panel order line, the Lab Test switch otherwise, read from the branch that
 * HOLDS the report).
 */
export interface LabReportNotesPrint {
  /** The matching Technician setting is on: the checkboxes show and the choice is honoured. */
  enabled: boolean;
  /** The report belongs to a lab panel order line (not a single test). */
  isPanelMember: boolean;
  /** Section keys left out of the printed report (empty = all print). */
  excludedSections: NoteSectionKey[];
}

/**
 * The Test Entry screen's Overall Result section — a technician-applied
 * `OverallResultTemplate` snapshot for ONE result parameter on this report
 * (a test can have several parameters, each independently tagged into its
 * own Overall Result group and each capable of holding its own separately-
 * applied result — see `LabReportOverallResultRow` model doc comment).
 * Unlike `LabReportContentSections`, there is NO `LabTest`-level fallback:
 * `LabTest` carries no default Overall Result, so a parameter with no
 * template ever applied simply has no entry in the `overallResults` array.
 * `templateId` is a logical reference (no Prisma relation) recording which
 * template produced `content`, purely so the UI can show which one is
 * currently active — editing `content` after applying never writes back to
 * the source `OverallResultTemplate`.
 */
export interface LabReportOverallResult {
  resultParamId: string;
  templateId: string | null;
  content: string | null;
}

/**
 * The technician's own text for ONE result parameter's Note on this report
 * (`LabReportParameterNote`). A parameter with no entry here keeps showing the
 * parameter's configured Note (`LabReportResultParam.notes`); an entry replaces it
 * for this report only. `content` is rich-text HTML and may be `''` (the
 * technician blanked the note on purpose).
 */
export interface LabReportParameterNote {
  resultParamId: string;
  content: string;
}

/**
 * One entry-grid row's *definition* (LABORATORY.docx §4.3) — what parameters
 * this test has, independent of whether any value has been entered yet.
 * `LabReportResultValue` rows only exist once a technician has saved at
 * least one value, so the entry grid can't be built from `resultValues`
 * alone; a brand-new `PENDING` report has zero result-value rows but still
 * needs its empty rows rendered. Sourced from `LabTestResultParam` (via
 * `LabReport.labTestId`, a logical ref — same treatment as `contentSections`
 * below). Empty array when there's no linked `LabTest` (a panel item,
 * direct/free-text entry, or branch-only test with no tenant catalogue
 * source) — matches `contentSections`'s all-null fallback for the same case.
 */
export interface LabReportResultParam {
  id: string;
  parameterName: string;
  parameterCode: string;
  resultType: ResultType;
  reportingUnit: string | null;
  method: string | null;
  sortOrder: number;
  /** When this parameter was added to the test (`LabTestResultParam.createdAt`)
   * — the Test Entry grid orders parameters within a group by this, not by
   * `sortOrder` (admin-configurable catalog order, a distinct concept the
   * technician doesn't see). */
  createdAt: Date;
  /**
   * Whether this parameter is dynamic/calculated. `CALCULATED` params derive
   * their value from `calculationFormula` (over other params' entered values)
   * and are shown disabled + auto-computed on the result-entry grid.
   */
  parameterType: ParameterType;
  /**
   * The calculation formula (parameter codes + `+ - * / ( )`), when this is a
   * calculated parameter with a formula defined; otherwise null. The frontend
   * uses it for a live preview; the backend re-evaluates it authoritatively on
   * save (see `LabReportService.upsertResultValues`).
   */
  calculationFormula: string | null;
  /** Decimal places for formatting a computed value (mirrors the param config). */
  decimalPlaces: number;
  /** Suggested values for this parameter's Observed 1 field (typeahead). */
  resultSuggestions: string[];
  /** Pre-fills Observed 1 when the technician hasn't entered a value yet. */
  defaultValue: string | null;
  /** Admin-configured section this parameter belongs to on the Test Entry
   * grid (e.g. "Chemical Examination", "Microscopic Examination") — purely
   * organizational, groups rows into collapsible sections. Null/empty groups
   * into an "Ungrouped" section on the frontend. */
  groupName: string | null;
  /** `OverallResultTemplate.groupName` values this parameter is tagged
   * compatible with (Master Data > Add Multiple Results > Configure >
   * "Overall Result" tab). Matched by plain string equality — no FK/relation.
   * Drives which Overall Result templates the Technician Dashboard offers for
   * a report whose test has this parameter (see `OverallResultTemplateService
   * .findAll`'s `groupName`/`groupNames` filter). Empty array = this
   * parameter isn't tagged into any Overall Result group. */
  overallResultGroups: string[];
  /** The parameter's configured Note (Master Data > Add Test > Add Result >
   * Notes), PLAIN text, or null when it has none. It is only the default: the
   * technician's own text for this report (`LabReportParameterNote`) replaces it
   * on this report. Never written from the technician screen. */
  notes: string | null;
}

/** Full detail response: the report plus its (possibly all-null) content
 * sections and (possibly empty) result-parameter definitions. Raw nested
 * shape (`orderItem.order.patient`) — used internally by callers that need
 * the full Prisma relation tree (e.g. `buildPrintContext`'s PDF variables).
 * `GET /lab-reports/:id`'s HTTP response uses `LabReportDetailApiResponse`
 * instead (flattened, see `LabReportService.findByIdForApi`). */
export type LabReportDetailWithContent = LabReportDetail & {
  contentSections: LabReportContentSections;
  /** One entry per result parameter that has an Overall Result applied —
   * NOT one per report (see `LabReportOverallResult`'s doc comment). A
   * parameter with nothing applied simply has no entry here. */
  overallResults: LabReportOverallResult[];
  /** One entry per result parameter whose Note the technician changed on THIS
   * report (see `LabReportParameterNote`); the rest inherit the configured Note. */
  parameterNotes: LabReportParameterNote[];
  resultParams: LabReportResultParam[];
};

/** `GET /lab-reports/:id`'s actual HTTP response shape — same flat branch/
 * department/order/patient/referredByDoctor/referralPanel/test fields
 * `LabReportWorklistRow` already returns from the list endpoint, plus the
 * detail-only fields (`resultValues`/`notes`/`attachments`/
 * `multiStepProcess`) and content sections/result-parameter definitions.
 * See `LabReportService.findByIdForApi`'s doc comment for why this is
 * flattened rather than reusing `LabReportDetailWithContent` as-is. */
export type LabReportDetailApiResponse = LabReportWorklistRow &
  Pick<LabReportDetail, 'notes' | 'attachments' | 'multiStepProcess'> & {
    /** Each stored value; one an analyzer filled also carries that analyzer's name. */
    resultValues: Array<
      LabReportDetail['resultValues'][number] & { analyzerName?: string | null }
    >;
    contentSections: LabReportContentSections;
    /** Which Notes sections print, and whether the technician may choose. */
    notesPrint: LabReportNotesPrint;
    overallResults: LabReportOverallResult[];
    parameterNotes: LabReportParameterNote[];
    resultParams: LabReportResultParam[];
  };

/** Relations eager-loaded for the worklist list view (lighter than full detail). */
export const LAB_REPORT_LIST_INCLUDE = {
  orderItem: {
    include: {
      order: {
        include: { patient: true, referredByDoctor: true, referralPanel: true },
      },
      branchLabTest: true,
      branchLabPanel: true,
    },
  },
  // the entry the holding branch works with, when it is not the order line's own
  performingEntry: true,
} satisfies Prisma.LabReportInclude;

export type LabReportListRow = Prisma.LabReportGetPayload<{
  include: typeof LAB_REPORT_LIST_INCLUDE;
}>;

export const AGE_TYPE_SUFFIX: Record<AgeType, string> = {
  YEARS: 'y',
  MONTHS: 'mo',
  DAYS: 'd',
};

/** The flat shape the Reporting Worklist table renders — one row per `LabReport`,
 * mirroring the 11 columns of LABORATORY.docx §1.2 that are backend-resolvable
 * today. Built from `LabReportListRow`'s nested include tree by `toWorklistRow`
 * (step 1 of the worklist-table build-out): Branch/Department names, test
 * result type, and the TAT/priority badge are each separate, later steps —
 * not resolved here yet, see the module's own tracking notes.
 */
export interface LabReportWorklistRow {
  id: string;
  status: LabReportStatus;
  isUrgent: boolean;
  isOutsourced: boolean;
  createdAt: Date;

  /** Whether a supervisor has locked this report against further result
   * edits (`POST /lab-reports/:id/lock`). The frontend uses this to disable
   * result-entry/status-change actions before the user clicks and hits a
   * `LabReportLockedException`, rather than only failing after the fact. */
  isLocked: boolean;

  /** Why the report was locked (the note typed in the Lock Test dialog), when
   * locked; null when unlocked or no reason was given. Lets the Unlock dialog
   * show the reason without reading the notes (which are blocked while locked). */
  lockNotes: string | null;
  /** When it was locked; null when unlocked. */
  lockedAt: Date | null;
  /** Who locked it (`Person.id`, logical ref); null when unlocked. */
  lockedBy: string | null;
  /** Display name for `lockedBy`, resolved by `LabReportService` (batched). */
  lockedByName: string | null;

  /** Raw ref (logical, no Prisma relation — see `Branch` everywhere else in
   * this codebase). Resolved to `branch.name` by `LabReportService.findAll`
   * via a batched lookup, not joined here. */
  branchId: string | null;
  branch: { id: string; name: string } | null;

  /** From `orderItem.branchLabTest.departmentId` / `orderItem.branchLabPanel.
   * departmentId` — whichever the order item actually used. Same logical-ref,
   * batched-lookup treatment as `branchId`/`branch` above (no Prisma relation
   * exists for `departmentId` anywhere in this codebase either). Null for a
   * `direct`/free-text order item, which has no catalogue department. */
  departmentId: string | null;
  department: { id: string; name: string } | null;

  /** `LabReport.labTestId` — the lookup key `attachResultTypes` uses to find
   * this row's `LabTestResultParam`s. Not itself a display field (the
   * consumer-facing value is `test.resultType`); kept here only so the
   * service can resolve result types with one batched query per page. */
  labTestId: string | null;

  /** `LabReport.memberBranchLabTestId` — set when this row is one member
   * test's report from a panel order item created after the per-member-test
   * breakdown shipped (a `BranchLabTest.id`, logical ref). Null for a
   * non-panel report, or a grandfathered pre-breakdown panel report. Not
   * itself a display field — the lookup key `attachMemberTestNames` uses to
   * resolve `test.name`/`kind` for a panel-member row (same batched-lookup
   * treatment as `branchId`/`departmentId` above). */
  memberBranchLabTestId: string | null;

  order: {
    id: string;
    orderCode: string;
    orderDate: Date;
    orderTime: string | null;
    /** When the order was actually placed (DB-guaranteed, `@default(now())`)
     * — the TIME shown next to `orderDate` in the worklist's "Order Date"
     * (instead of `orderTime`, a manually-typed, optional backdating field,
     * often left blank). The DATE shown, and filtered on, is `orderDate`. */
    createdAt: Date;
    billingType: BillingType;
    paymentStatus: PaymentStatus;
    /** CANCELLED freezes the report: the worklist shows an "Order cancelled" tag
     * and every action on the row is refused. */
    status: OrderStatus;
  } | null;

  patient: {
    id: string;
    name: string;
    age: number | null;
    ageType: AgeType | null;
    ageDisplay: string | null;
    gender: Gender | null;
    umId: string | null;
    mobile: string | null;
  } | null;

  referredByDoctor: { id: string; name: string } | null;
  referralPanel: { id: string; name: string } | null;

  test: {
    id: string;
    name: string;
    kind: 'TEST' | 'PANEL' | 'DIRECT';
    /** Only set when the test has exactly one `LabTestResultParam` — matches
     * every example anyone (the doc, the FE mock) has actually used (Urea,
     * HIV). A multi-parameter test (e.g. CBC — Hemoglobin/WBC/Platelets, each
     * with its own type) has no single well-defined result type, so this is
     * left null rather than guessing one parameter's type for the whole test.
     * Resolved by `LabReportService.attachResultTypes` from `LabReport.
     * labTestId` (a logical ref, no Prisma relation — same treatment as
     * `branchId`/`departmentId`). Null for panel/direct order items too,
     * since `resultType` only exists on `LabTest`'s own result params. */
    resultType: ResultType | null;
  } | null;

  /** True when this report's test was removed from the order: the report is kept
   * (visible, tagged "Test removed from order") but frozen - every write is refused
   * (409 `LAB_REPORT_ITEM_REMOVED`) and it never prints. Derived from the order
   * item's `deletedAt`, not stored. */
  itemRemoved: boolean;

  /** `LabReport.orderItemId` — the lookup key `attachSampleStatuses` uses to
   * find this row's `OrderSampleTest`(s). Not itself a display field. */
  orderItemId: string;

  /** The real Accession sample-lifecycle status(es) for this row (client
   * requirement: "technician should be able to see all the statuses from
   * both modules"). An order item can be linked to more than one
   * `OrderSample` (e.g. a test requiring both a blood tube and a urine
   * cup — see `OrderSampleService.generateForOrderInTx`'s per-sample-type
   * grouping), so this is every distinct status among them, not a single
   * picked value. Empty array if no linked sample is found (shouldn't happen
   * in practice — a `LabReport` only exists once a sample has been accepted —
   * but resolved defensively rather than assumed). View-only: this does not
   * grant or check any permission to change these statuses (see the module's
   * own tracking notes — enforcement is a separate, not-yet-built piece).
   */
  sampleStatuses: SampleStatus[];

  /** Analytical-TAT figure for this row (SRS §6.2). Null until attached by
   * `LabReportService.findAll` via `TatService.computeBandsForReports`. */
  tat: WorklistTat | null;

  /** The `OrderSample.id`(s) linked to this row, in the same order as
   * `sampleStatuses` (index-paired) — lets the frontend's Sample Overview
   * action call Accession's own, already-complete panel endpoint (`GET
   * /accession/samples/:id`, ACCESSION.docx §A.10.4/§B.9) directly, rather
   * than duplicating that logic on the Technician side. Empty array under the
   * same (rare/defensive) condition as `sampleStatuses`.
   */
  sampleIds: string[];

  /** The `OrderSample.barcode`(s) linked to this row, in the same order as
   * `sampleIds`/`sampleStatuses` (index-paired) — the physical tube/container
   * barcode, shared across every test drawn from the same sample. Null entry
   * where a linked sample hasn't been barcoded yet (Accession's "Assign
   * Barcode" step). Empty array under the same (rare/defensive) condition as
   * `sampleStatuses`. */
  sampleBarcodes: (string | null)[];
  /** Index-paired with `sampleIds` — the branch each linked sample belongs to.
   * After an internal transfer an item has the sender's original and the
   * receiver's copy; this lets each viewer see the status of ITS OWN sample. */
  sampleBranchIds: (string | null)[];
  /** The branch the Branch column shows for THIS caller (set by `attachDisplayBranch`,
   * see `pickDisplayBranchId`): the branch that sent the caller's own copy of the
   * sample, or the caller's own branch when it holds the original. `branch` is always
   * the branch that holds the report. Null when none of the caller's branches holds a
   * linked sample — the screen then shows `branch`. */
  displayBranch?: { id: string; name: string } | null;
  /** `full` when a branch of the caller holds the report; `view` when it is only
   * listed because the caller's branch sent it, or its sample is sent out and
   * waiting for the receiver (view and print only). */
  accessMode?: 'full' | 'view';
  /** Set when the holder branch's own sample is Sent and the receiving branch has
   * already sent the report back (its transfer is closed as REPEAT / REJECTED): the
   * report is reset and waiting for the sender to decide (Repeat / Error / Retrieve).
   * Set by `attachReturnedByReceiver`; null otherwise. The screen words the
   * view-only tag from it ("Returned by receiving branch") instead of "Sent". */
  returnedByReceiver?: {
    kind: 'REPEAT' | 'REJECTED';
    reason: string | null;
  } | null;

  /** Whether this test has been assigned to a multi-step process
   * (LABORATORY.docx §5.7 — Histopathology/Bone Marrow/Cytology/IHC, tracked
   * through Grossing→Sectioning→Staining→Reporting), and if so, which
   * process and which stage it's currently at. Resolved by
   * `LabReportService.attachMultiStepProcess` from `MultiStepTestProcess`
   * (one row per report, `labReportId` unique) — a batched lookup, same
   * shape as `attachSampleStatuses`. Null for a test never assigned to a
   * multi-step process (the overwhelming majority — most tests are single-
   * step). View-only: shows which process/stage a test is at in list views
   * (e.g. Order Overview) without needing to open the report's own detail. */
  multiStepProcessType: MultiStepProcessType | null;
  multiStepStage: MultiStepStage | null;
}

/** One resolved candidate for the Approve modal's Signatory Authority
 * dropdowns (`GET /lab-reports/:id/signatory-candidates`). `slot` is this
 * candidate's position after sorting the department's `isSignatory` mappings
 * by priority (ascending) and capping at 3 — not the raw `priority` number
 * itself, which is included separately for display/debugging. `resolvable`
 * is false when the underlying Person/Doctor record could not be found
 * (soft-deleted after being mapped) — such a candidate is still included
 * (not silently dropped, which would shift a later slot into its place) but
 * the frontend should render it disabled, and `approve()` rejects selecting
 * it. */
export interface LabReportSignatoryCandidate {
  slot: 1 | 2 | 3;
  priority: number;
  personId: string;
  type: 'USER' | 'CONSULTANT_DOCTOR' | 'REPORTING_DOCTOR';
  displayName: string;
  designation: string | null;
  resolvable: boolean;
}

export interface LabReportSignatoryCandidatesResponse {
  departmentId: string | null;
  candidates: LabReportSignatoryCandidate[];
}

export function fullName(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(' ');
}

/**
 * The Doctor columns a printed report needs for a signing Doctor — shared by
 * the `<signing_authority_tag>` signatory block and the flat
 * `{report_approved_by_*}` tags so both always read the same fields. Active
 * qualifications are ordered like the Doctor detail endpoint
 * (`DOCTOR_DETAIL_INCLUDE`).
 */
export const SIGNING_DOCTOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  signatoryDesignation: true,
  registrationNo: true,
  registrationCouncil: true,
  signatureImagePath: true,
  isNablAuthorized: true,
  isCapCertified: true,
  isIsoCertified: true,
  qualifications: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { degree: true },
  },
} satisfies Prisma.DoctorSelect;

/**
 * Comma-joined accreditation labels for a signing Doctor (e.g. "NABL
 * Authorized, CAP Certified") — empty when none of the flags are set. Backs
 * `{report_approved_by_certifications}` and the signatory block's per-doctor
 * certifications.
 */
export function doctorCertifications(d: {
  isNablAuthorized: boolean;
  isCapCertified: boolean;
  isIsoCertified: boolean;
}): string {
  return [
    d.isNablAuthorized ? 'NABL Authorized' : null,
    d.isCapCertified ? 'CAP Certified' : null,
    d.isIsoCertified ? 'ISO Certified' : null,
  ]
    .filter((c): c is string => c !== null)
    .join(', ');
}

/**
 * Comma-joined degrees of a signing Doctor's active qualifications, in the
 * order they were added (e.g. "MBBS, MD (Pathology)") — empty when none are
 * recorded. Backs `{report_approved_by_qualification}`.
 */
export function doctorQualification(
  qualifications: Array<{ degree: string | null }>,
): string {
  return qualifications
    .map((q) => q.degree?.trim())
    .filter((deg): deg is string => Boolean(deg))
    .join(', ');
}

/** Maps one raw `LabReportListRow` (Prisma's nested include tree) into the flat
 * `LabReportWorklistRow` shape the worklist table needs. Pure reshaping — no
 * new queries, no new data beyond what `LAB_REPORT_LIST_INCLUDE` already fetches.
 */
export function toWorklistRow(row: LabReportListRow): LabReportWorklistRow {
  const order = row.orderItem?.order ?? null;
  const patient = order?.patient ?? null;
  const referredByDoctor = order?.referredByDoctor ?? null;
  const referralPanel = order?.referralPanel ?? null;
  const branchLabTest = row.orderItem?.branchLabTest ?? null;
  const branchLabPanel = row.orderItem?.branchLabPanel ?? null;

  return {
    id: row.id,
    status: row.status,
    isUrgent: row.isUrgent,
    isOutsourced: row.isOutsourced,
    createdAt: row.createdAt,
    isLocked: row.isLocked,
    lockNotes: row.isLocked ? (row.lockNotes ?? null) : null,
    lockedAt: row.isLocked ? (row.lockedAt ?? null) : null,
    lockedBy: row.isLocked ? (row.lockedBy ?? null) : null,
    lockedByName: null,

    branchId: row.branchId,
    branch: null,

    // The department of the setup the HOLDING branch works the test with: its own
    // entry once the report was sent to it (even when that entry has no department),
    // otherwise the order line's.
    departmentId: row.performingEntry
      ? row.performingEntry.departmentId
      : (branchLabTest?.departmentId ?? branchLabPanel?.departmentId ?? null),
    department: null,

    labTestId: row.labTestId,
    memberBranchLabTestId: row.memberBranchLabTestId,

    order: order
      ? {
          id: order.id,
          orderCode: order.orderCode,
          orderDate: order.orderDate,
          orderTime: order.orderTime,
          createdAt: order.createdAt,
          billingType: order.billingType,
          paymentStatus: order.paymentStatus,
          status: order.status,
        }
      : null,

    patient: patient
      ? {
          id: patient.id,
          name: fullName([
            patient.firstName,
            patient.middleName,
            patient.lastName,
          ]),
          age: patient.age,
          ageType: patient.ageType,
          ageDisplay:
            patient.age != null
              ? `${patient.age}${AGE_TYPE_SUFFIX[patient.ageType ?? 'YEARS']}`
              : null,
          gender: patient.gender,
          umId: patient.umId,
          mobile: patient.mobile,
        }
      : null,

    referredByDoctor: referredByDoctor
      ? {
          id: referredByDoctor.id,
          name: fullName([
            referredByDoctor.firstName,
            referredByDoctor.middleName,
            referredByDoctor.lastName,
          ]),
        }
      : null,

    referralPanel: referralPanel
      ? { id: referralPanel.id, name: referralPanel.name }
      : null,

    // A panel-member row (`memberBranchLabTestId` set) displays as its own
    // TEST, not as the parent PANEL — placeholder name here, filled in by
    // `attachMemberTestNames` (a real DB lookup, same batched treatment as
    // `branch`/`department` above; `toWorklistRow` itself makes no queries).
    // Falls through to the pre-breakdown PANEL/TEST/DIRECT resolution below
    // for every other row, including a grandfathered old-style panel report.
    test: row.memberBranchLabTestId
      ? {
          id: row.memberBranchLabTestId,
          name: '',
          kind: 'TEST',
          resultType: null,
        }
      : branchLabTest
        ? {
            id: branchLabTest.id,
            name: branchLabTest.testName,
            kind: 'TEST',
            resultType: null,
          }
        : branchLabPanel
          ? {
              id: branchLabPanel.id,
              name: branchLabPanel.panelName,
              kind: 'PANEL',
              resultType: null,
            }
          : row.orderItem?.direct
            ? {
                id: row.orderItem.id,
                name: row.orderItem.direct,
                kind: 'DIRECT',
                resultType: null,
              }
            : null,

    orderItemId: row.orderItemId,
    itemRemoved: row.orderItem?.deletedAt != null,
    sampleStatuses: [],
    sampleIds: [],
    sampleBarcodes: [],
    sampleBranchIds: [],
    displayBranch: null,
    returnedByReceiver: null,
    tat: null,

    multiStepProcessType: null,
    multiStepStage: null,
  };
}

/** Live counts per status tab (LABORATORY.docx §1.1 element 6 — Status tabs). */
export interface LabReportStatusCounts {
  all: number;
  pending: number;
  partialPending: number;
  saved: number;
  validationPending: number;
  resultDone: number;
  approved: number;
  published: number;
  errorReported: number;
  resultRejected: number;
  bySource: { inHouse: number; outsource: number };
}

/** The transition matrix from LABORATORY.docx §2.2 — one entry per gated action. */
export const LAB_REPORT_ALLOWED_FROM = {
  save: ['PENDING', 'PARTIAL_PENDING', 'SAVED'],
  submit: ['PENDING', 'PARTIAL_PENDING', 'SAVED'],
  validate: ['VALIDATION_PENDING'],
  // APPROVED included per LABORATORY.docx §6.7/§6.10 — Edit Report is a
  // documented "other action" on Approved reports, sending them back to
  // Saved for correction before Publish.
  editReport: ['VALIDATION_PENDING', 'RESULT_DONE', 'APPROVED'],
  reject: ['VALIDATION_PENDING'],
  resubmit: ['RESULT_REJECTED', 'ERROR_REPORTED'],
  approve: ['RESULT_DONE'],
  publish: ['APPROVED'],
  errorReported: ['APPROVED', 'PUBLISHED'],
  // Re-Run is allowed from any status per the spec ("Any status" row) — no
  // ALLOWED_FROM_STEPS gate is applied to it; see LabReportService.reRun.
} as const satisfies Record<string, readonly LabReportStatus[]>;

export type LabReportTransitionAction = keyof typeof LAB_REPORT_ALLOWED_FROM;

/**
 * The only statuses in which a report's result values may be changed (`PATCH /lab-reports/:id/results`). Once a report
 * is submitted and moves on, its values are fixed: a correction goes through Edit Report (back to Saved) or Re-Run
 * (back to Pending), both of which land in this list again.
 */
export const LAB_REPORT_RESULT_EDIT_STATUSES = [
  'PENDING',
  'PARTIAL_PENDING',
  'SAVED',
] as const satisfies readonly LabReportStatus[];
