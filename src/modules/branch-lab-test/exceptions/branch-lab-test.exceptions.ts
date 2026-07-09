import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch lab test not found within the tenant/branch. */
export class BranchLabTestNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_LAB_TEST_NOT_FOUND',
      'Branch lab test not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active branch lab test already uses this name. */
export class BranchLabTestNameConflictException extends KaltrosException {
  constructor(testName: string) {
    super(
      'BRANCH_LAB_TEST_NAME_CONFLICT',
      'A branch lab test with this name already exists',
      { testName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active branch lab test already uses this code. */
export class BranchLabTestCodeConflictException extends KaltrosException {
  constructor(testCode: string) {
    super(
      'BRANCH_LAB_TEST_CODE_CONFLICT',
      'A branch lab test with this code already exists',
      { testCode },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — a variant group already has an active default (one default per source). */
export class BranchLabTestDefaultConflictException extends KaltrosException {
  constructor() {
    super(
      'BRANCH_LAB_TEST_DEFAULT_CONFLICT',
      'This test already has a default variant in the branch list',
      {},
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 400 — the caller's JWT has no active branch, but the operation is branch-level.
 * Shared by the branch-lab-test and branch-lab-panel controllers.
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
