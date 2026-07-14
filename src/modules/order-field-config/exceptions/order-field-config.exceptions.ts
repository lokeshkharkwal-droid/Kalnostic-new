import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * 422 — the order field configuration is branch-specific, but the caller's
 * active profile has no branch (e.g. a tenant-level profile). A branch context
 * is required to read or save it.
 */
export class OrderFieldConfigBranchRequiredException extends KaltrosException {
  constructor() {
    super(
      'ORDER_FIELD_CONFIG_BRANCH_REQUIRED',
      'An active branch is required to read or save the order field configuration',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
