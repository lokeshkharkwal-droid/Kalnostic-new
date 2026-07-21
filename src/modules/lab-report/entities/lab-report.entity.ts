import { LabReportStatus, Prisma } from '@prisma/client';

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

/** Full detail response: the report plus its (possibly all-null) content sections. */
export type LabReportDetailWithContent = LabReportDetail & {
  contentSections: LabReportContentSections;
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
  editReport: ['VALIDATION_PENDING', 'RESULT_DONE'],
  reject: ['VALIDATION_PENDING'],
  resubmit: ['RESULT_REJECTED', 'ERROR_REPORTED'],
  approve: ['RESULT_DONE'],
  publish: ['APPROVED'],
  errorReported: ['APPROVED', 'PUBLISHED'],
  // Re-Run is allowed from any status per the spec ("Any status" row) — no
  // ALLOWED_FROM_STEPS gate is applied to it; see LabReportService.reRun.
} as const satisfies Record<string, readonly LabReportStatus[]>;

export type LabReportTransitionAction = keyof typeof LAB_REPORT_ALLOWED_FROM;
