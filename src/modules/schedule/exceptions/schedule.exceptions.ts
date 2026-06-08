import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — schedule not found within the branch/tenant. */
export class ScheduleNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'SCHEDULE_NOT_FOUND',
      'Schedule not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 409 — an ACTIVE schedule already covers an overlapping date range for this
 * branch. Only one ACTIVE schedule may apply to any given date.
 */
export class ScheduleOverlapException extends KaltrosException {
  constructor(branchId: string, conflictsWith: string) {
    super(
      'SCHEDULE_DATE_OVERLAP',
      'An active schedule already covers this date range for the branch',
      { branchId, conflictsWith },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — a shift is internally invalid (bad times, break outside shift, etc.). */
export class InvalidShiftException extends KaltrosException {
  constructor(reason: string, context: Record<string, unknown> = {}) {
    super('INVALID_SHIFT', reason, context, HttpStatus.BAD_REQUEST);
  }
}

/** 400 — `effectiveTo` is before `effectiveFrom`. */
export class InvalidScheduleDatesException extends KaltrosException {
  constructor(effectiveFrom: string, effectiveTo: string) {
    super(
      'INVALID_SCHEDULE_DATES',
      'effectiveTo must be on or after effectiveFrom',
      { effectiveFrom, effectiveTo },
      HttpStatus.BAD_REQUEST,
    );
  }
}
