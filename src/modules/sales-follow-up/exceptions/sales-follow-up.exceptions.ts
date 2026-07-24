import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — follow-up not found within the tenant. */
export class FollowUpNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'FOLLOW_UP_NOT_FOUND',
      'Follow-up not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 400 — the referenced lead is invalid for the caller's tenant/branch. */
export class InvalidFollowUpLeadException extends KaltrosException {
  constructor(leadId: string) {
    super(
      'INVALID_FOLLOW_UP_LEAD',
      'The referenced lead is invalid for this branch',
      { leadId },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — the referenced trip is invalid for the caller's tenant/branch. */
export class InvalidFollowUpTripException extends KaltrosException {
  constructor(tripId: string) {
    super(
      'INVALID_FOLLOW_UP_TRIP',
      'The referenced trip is invalid for this branch',
      { tripId },
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
