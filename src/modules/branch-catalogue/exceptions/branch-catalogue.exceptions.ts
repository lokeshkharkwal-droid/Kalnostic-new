import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/**
 * 400 — the supplied `branch_type` query param does not match any branch type
 * in the catalogue. The message lists the valid types so the client can
 * correct the request.
 */
export class InvalidBranchTypeException extends KaltrosException {
  constructor(branchType: string, available: string[]) {
    super(
      'INVALID_BRANCH_TYPE',
      `Invalid branch_type '${branchType}'. Available types: ${available.join(', ')}`,
      { branchType },
      HttpStatus.BAD_REQUEST,
    );
  }
}
