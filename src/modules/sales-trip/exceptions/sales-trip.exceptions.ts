import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — trip not found within the tenant. */
export class TripNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('TRIP_NOT_FOUND', 'Trip not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/** 404 — trip visit not found within the trip. */
export class TripVisitNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'TRIP_VISIT_NOT_FOUND',
      'Trip visit not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 400 — the referenced person is not a valid salesperson: not an active staff
 * member of the caller's tenant. (Any staff Person qualifies in this phase.)
 */
export class InvalidSalespersonException extends KaltrosException {
  constructor(personId: string) {
    super(
      'INVALID_SALESPERSON',
      'The selected salesperson is not an active staff member of this business',
      { personId },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — the referenced lead is invalid for the caller's tenant/branch. */
export class InvalidTripLeadException extends KaltrosException {
  constructor(leadId: string) {
    super(
      'INVALID_TRIP_LEAD',
      'The referenced lead is invalid for this branch',
      { leadId },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — the caller's JWT has no active branch, but the operation is branch-level.
 */
export class ActiveBranchRequiredException extends KaltrosException {
  constructor() {
    super(
      'ACTIVE_BRANCH_REQUIRED',
      'An active branch is required for this operation. Switch to a branch profile.',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}
