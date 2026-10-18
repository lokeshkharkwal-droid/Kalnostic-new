import { LabReportStatus } from '@prisma/client';

/**
 * Report statuses whose results may be printed on a patient-facing document:
 * validated (Result Done), Approved and Published. Everything earlier — and a
 * rejected or error-flagged report — still has results nobody has signed off, so
 * those must never reach a printed or shared report.
 */
export const PRINTABLE_REPORT_STATUSES: ReadonlySet<LabReportStatus> = new Set([
  LabReportStatus.RESULT_DONE,
  LabReportStatus.APPROVED,
  LabReportStatus.PUBLISHED,
]);

/** The text printed in place of results that are not ready. */
export const RESULT_PENDING_TEXT = 'Result pending';

/** True when a report in `status` may show its results on a printed report. */
export function isReportPrintable(status: LabReportStatus): boolean {
  return PRINTABLE_REPORT_STATUSES.has(status);
}

/** The statuses that print as "Result pending" (the complement of the above). */
export const UNFINISHED_REPORT_STATUSES: LabReportStatus[] = Object.values(
  LabReportStatus,
).filter((s) => !PRINTABLE_REPORT_STATUSES.has(s));

/**
 * The single results row printed for a test whose results are not ready: the test
 * name with "Result pending" where the value goes, same shape as a real row so
 * every template renders it without changes.
 */
export function pendingResultRow(testName: string): {
  parameter_name: string;
  observed1: string;
  observed2: string;
  unit: string;
  methodology: string;
  method_name: string;
  reference_display: string;
  group_name: string;
  result_note: string;
  overall_result: string;
} {
  return {
    parameter_name: testName,
    observed1: RESULT_PENDING_TEXT,
    observed2: '',
    unit: '',
    methodology: '',
    method_name: '',
    reference_display: '',
    group_name: '',
    result_note: '',
    overall_result: '',
  };
}
