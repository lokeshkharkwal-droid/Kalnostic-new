import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — lead not found within the tenant. */
export class LeadNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('LEAD_NOT_FOUND', 'Lead not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/**
 * 409 — a duplicate lead was detected (matching mobile/email/GST/org name per the
 * tenant's Sales settings duplicate-detection rules).
 */
export class DuplicateLeadException extends KaltrosException {
  constructor(field: string, value: string) {
    super(
      'DUPLICATE_LEAD',
      `A lead with this ${field} already exists`,
      { field, value },
      HttpStatus.CONFLICT,
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
