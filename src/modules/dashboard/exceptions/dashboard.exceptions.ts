import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * 403 — a branch-admin dashboard request supplied a `branchId` other than
 * their own active branch. Branch-admin is scoped to exactly one branch; the
 * query param is validated against the caller's JWT profile, never trusted
 * on its own.
 */
export class BranchScopeDeniedException extends KaltrosException {
  constructor(requestedBranchId: string, ownBranchId: string) {
    super(
      'BRANCH_SCOPE_DENIED',
      'You do not have access to that branch',
      { requestedBranchId, ownBranchId },
      HttpStatus.FORBIDDEN,
    );
  }
}
