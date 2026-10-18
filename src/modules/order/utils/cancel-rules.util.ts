import { LabReportStatus } from '@prisma/client';
import { VALIDATED_REPORT_STATUSES } from '../../lab-report/utils/validated-report.util';

/**
 * Report statuses that stop an order from being cancelled: the result is
 * validated (Result Done) or beyond (Approved, Published). Everything earlier -
 * Pending, Saved, Validation Pending - and the problem states (Error Reported,
 * Result Rejected) still allow a cancel. The check uses a report's CURRENT status,
 * so one sent back to Saved for correction stops blocking.
 */
export const CANCEL_BLOCKING_REPORT_STATUSES: LabReportStatus[] =
  VALIDATED_REPORT_STATUSES;
