import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * 403 — the caller lacks one or more permissions required by a route (enforced
 * by the business permission guard, `@RequirePermission`). The missing keys are
 * logged server-side in `context` but never returned to the client.
 */
export class PermissionDeniedException extends KaltrosException {
  constructor(missing: string[]) {
    super(
      'PERMISSION_DENIED',
      'You do not have permission to perform this action',
      { missing },
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * 403 — a Branch Admin attempted to manage a branch-role outside their own
 * active branch. Business Admins (tenant-level context) are not subject to this.
 */
export class BranchScopeViolationException extends KaltrosException {
  constructor(requestedBranchId: string, allowedBranchId: string | null) {
    super(
      'BRANCH_SCOPE_VIOLATION',
      'You may only manage permissions for your own branch',
      { requestedBranchId, allowedBranchId },
      HttpStatus.FORBIDDEN,
    );
  }
}
