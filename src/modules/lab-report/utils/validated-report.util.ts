import { LabReportStatus } from '@prisma/client';

/**
 * Report statuses whose result is validated: Result Done, Approved and Published.
 * The one list behind every "once a result is done" rule - an order can no longer
 * be cancelled, and a transferred test can no longer be sent back for a repeat.
 * Everything earlier (Pending, Saved, Validation Pending, Error Reported, Result
 * Rejected) is still work in progress.
 */
export const VALIDATED_REPORT_STATUSES: LabReportStatus[] = [
  LabReportStatus.RESULT_DONE,
  LabReportStatus.APPROVED,
  LabReportStatus.PUBLISHED,
];

/** True when a report in `status` already has a validated result. */
export function isReportValidated(status: LabReportStatus): boolean {
  return VALIDATED_REPORT_STATUSES.includes(status);
}
