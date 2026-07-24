import {
  AgeType,
  BillingType,
  Gender,
  LabReportStatus,
  Prisma,
  ResultType,
  SampleStatus,
} from '@prisma/client';

/** Relations eager-loaded when fetching a report's full detail (Test Entry screen). */
export const LAB_REPORT_DETAIL_INCLUDE = {
  resultValues: { where: { deletedAt: null } },
  notes: { orderBy: { createdAt: 'desc' } },
  attachments: { orderBy: { uploadedAt: 'desc' } },
  multiStepProcess: true,
  orderItem: {
    include: {
      order: { include: { patient: true, referredByDoctor: true, referralPanel: true } },
      branchLabTest: true,
      branchLabPanel: true,
    },
  },
} satisfies Prisma.LabReportInclude;

/** A report with its result values, notes, attachments, and order context. */
export type LabReportDetail = Prisma.LabReportGetPayload<{
  include: typeof LAB_REPORT_DETAIL_INCLUDE;
}>;

/**
 * The Test Entry screen's read-only content sections (LABORATORY.docx §4.5),
 * sourced from the tenant-level `LabTest` master (via `LabReport.labTestId` —
 * a logical ref, no Prisma relation, so this is resolved with a separate
 * query rather than an `include`). All null when the report has no linked
 * `LabTest` (a panel item, a direct/free-text entry, or a branch-only test
 * with no tenant catalogue source).
 */
export interface LabReportContentSections {
  usefulFor: string | null;
  interpretation: string | null;
  limitations: string | null;
  references: string | null;
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
}

/** Full detail response: the report plus its (possibly all-null) content
 * sections and (possibly empty) result-parameter definitions. Raw nested
 * shape (`orderItem.order.patient`) — used internally by callers that need
 * the full Prisma relation tree (e.g. `buildPrintContext`'s PDF variables).
 * `GET /lab-reports/:id`'s HTTP response uses `LabReportDetailApiResponse`
 * instead (flattened, see `LabReportService.findByIdForApi`). */
export type LabReportDetailWithContent = LabReportDetail & {
  contentSections: LabReportContentSections;
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
  Pick<LabReportDetail, 'resultValues' | 'notes' | 'attachments' | 'multiStepProcess'> & {
    contentSections: LabReportContentSections;
    resultParams: LabReportResultParam[];
  };

/** Relations eager-loaded for the worklist list view (lighter than full detail). */
export const LAB_REPORT_LIST_INCLUDE = {
  orderItem: {
    include: {
      order: { include: { patient: true, referredByDoctor: true, referralPanel: true } },
      branchLabTest: true,
      branchLabPanel: true,
    },
  },
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

  order: {
    id: string;
    orderCode: string;
    orderDate: Date;
    orderTime: string | null;
    billingType: BillingType;
  } | null;

  patient: {
    id: string;
    name: string;
    age: number | null;
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

  /** `LabReport.orderItemId` — the lookup key `attachSampleStatuses` uses to
   * find this row's `AccessionSampleTest`(s). Not itself a display field. */
  orderItemId: string;

  /** The real Accession sample-lifecycle status(es) for this row (client
   * requirement: "technician should be able to see all the statuses from
   * both modules"). An order item can be linked to more than one
   * `AccessionSample` (e.g. a test requiring both a blood tube and a urine
   * cup — see `AccessionSampleService.generateForOrderInTx`'s per-sample-type
   * grouping), so this is every distinct status among them, not a single
   * picked value. Empty array if no linked sample is found (shouldn't happen
   * in practice — a `LabReport` only exists once a sample has been accepted —
   * but resolved defensively rather than assumed). View-only: this does not
   * grant or check any permission to change these statuses (see the module's
   * own tracking notes — enforcement is a separate, not-yet-built piece).
   */
  sampleStatuses: SampleStatus[];

  /** The `AccessionSample.id`(s) linked to this row, in the same order as
   * `sampleStatuses` (index-paired) — lets the frontend's Sample Overview
   * action call Accession's own, already-complete panel endpoint (`GET
   * /accession/samples/:id`, ACCESSION.docx §A.10.4/§B.9) directly, rather
   * than duplicating that logic on the Technician side. Empty array under the
   * same (rare/defensive) condition as `sampleStatuses`.
   */
  sampleIds: string[];
}

export function fullName(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(' ');
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

    branchId: row.branchId,
    branch: null,

    departmentId: branchLabTest?.departmentId ?? branchLabPanel?.departmentId ?? null,
    department: null,

    labTestId: row.labTestId,

    order: order
      ? {
          id: order.id,
          orderCode: order.orderCode,
          orderDate: order.orderDate,
          orderTime: order.orderTime,
          billingType: order.billingType,
        }
      : null,

    patient: patient
      ? {
          id: patient.id,
          name: fullName([patient.firstName, patient.middleName, patient.lastName]),
          age: patient.age,
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

    test: branchLabTest
      ? { id: branchLabTest.id, name: branchLabTest.testName, kind: 'TEST', resultType: null }
      : branchLabPanel
        ? { id: branchLabPanel.id, name: branchLabPanel.panelName, kind: 'PANEL', resultType: null }
        : row.orderItem?.direct
          ? { id: row.orderItem.id, name: row.orderItem.direct, kind: 'DIRECT', resultType: null }
          : null,

    orderItemId: row.orderItemId,
    sampleStatuses: [],
    sampleIds: [],
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
