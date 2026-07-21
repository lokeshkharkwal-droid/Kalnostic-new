import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — lab report not found within the tenant/branch. */
export class LabReportNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('LAB_REPORT_NOT_FOUND', 'Lab report not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/** 422 — the caller has no active branch context (required for all routes). */
export class ActiveBranchRequiredException extends KaltrosException {
  constructor() {
    super(
      'ACTIVE_BRANCH_REQUIRED',
      'An active branch is required to perform this action',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 409 — the requested action's `from` status doesn't match the report's actual
 * current status (LABORATORY.docx §2.2 transition matrix). Mirrors the old
 * backend's `ALLOWED_FROM_STEPS` guard pattern, adapted to this schema's
 * `LabReportStatus` enum.
 */
export class InvalidLabReportTransitionException extends KaltrosException {
  constructor(
    action: string,
    currentStatus: string,
    allowedFrom: readonly string[],
  ) {
    super(
      'INVALID_LAB_REPORT_TRANSITION',
      `Cannot ${action} a report in status ${currentStatus}`,
      { action, currentStatus, allowedFrom },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — a locked report cannot be edited (results, save, submit, etc.). */
export class LabReportLockedException extends KaltrosException {
  constructor(id: string) {
    super(
      'LAB_REPORT_LOCKED',
      'This report is locked and cannot be edited. Ask a supervisor to unlock it.',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}

/** 403 — unlocking a report requires the supervisor unlock permission. */
export class UnlockNotPermittedException extends KaltrosException {
  constructor() {
    super(
      'UNLOCK_NOT_PERMITTED',
      'You do not have permission to unlock a locked report',
      {},
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 422 — reject/error-reported/re-run require notes per LABORATORY.docx §5/§6. */
export class LabReportNotesRequiredException extends KaltrosException {
  constructor(action: string) {
    super(
      'LAB_REPORT_NOTES_REQUIRED',
      `Notes are required to ${action}`,
      { action },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 404 — the order item has no lab report yet (sample not accepted, or already exists check). */
export class OrderItemLabReportNotFoundException extends KaltrosException {
  constructor(orderItemId: string) {
    super(
      'ORDER_ITEM_LAB_REPORT_NOT_FOUND',
      'This order item has no report yet',
      { orderItemId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 404 — no result parameter catalogue exists to resolve a reference range against. */
export class LabTestCatalogueMissingException extends KaltrosException {
  constructor(labReportId: string) {
    super(
      'LAB_TEST_CATALOGUE_MISSING',
      'This report has no linked lab test catalogue entry to resolve reference ranges against',
      { labReportId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 404 — a worklist entry (Re-Run/Critical Alert/Out of Range/Delta Check/Scheduled Test) was not found. */
export class WorklistEntryNotFoundException extends KaltrosException {
  constructor(worklist: string, id: string) {
    super(
      `${worklist.toUpperCase()}_NOT_FOUND`,
      `${worklist.replace(/_/g, ' ')} entry not found`,
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 404 — the referenced person is not an active technician (lab_technician /
 * junior_lab_technician / senior_lab_technician) at the caller's branch.
 * Used validating `ScheduledTest.assignedToId` (LABORATORY.docx §5.6 "Assign
 * To" field), mirroring PhlebotomistNotFoundException's role-check pattern.
 */
export class TechnicianNotFoundException extends KaltrosException {
  constructor(personId: string) {
    super(
      'TECHNICIAN_NOT_FOUND',
      'No active technician found for this branch',
      { personId },
      HttpStatus.NOT_FOUND,
    );
  }
}
