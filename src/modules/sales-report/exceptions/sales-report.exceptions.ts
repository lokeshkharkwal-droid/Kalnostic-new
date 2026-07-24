import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * 400 — the caller's JWT has no active branch, but sales reports are branch-level.
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
