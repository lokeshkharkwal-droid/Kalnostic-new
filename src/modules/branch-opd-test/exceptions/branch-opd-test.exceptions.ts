import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch opd test not found within the tenant/branch. */
export class BranchOpdTestNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_OPD_TEST_NOT_FOUND',
      'Branch opd test not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active branch opd test already uses this name. */
export class BranchOpdTestNameConflictException extends KaltrosException {
  constructor(testName: string) {
    super(
      'BRANCH_OPD_TEST_NAME_CONFLICT',
      'A branch opd test with this name already exists',
      { testName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active branch opd test already uses this code. */
export class BranchOpdTestCodeConflictException extends KaltrosException {
  constructor(testCode: string) {
    super(
      'BRANCH_OPD_TEST_CODE_CONFLICT',
      'A branch opd test with this code already exists',
      { testCode },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — a variant group already has an active default (one default per source). */
export class BranchOpdTestDefaultConflictException extends KaltrosException {
  constructor() {
    super(
      'BRANCH_OPD_TEST_DEFAULT_CONFLICT',
      'This test already has a default variant in the branch list',
      {},
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 400 — the caller's JWT has no active branch, but the operation is branch-level.
 * Shared by the branch-opd-test, -panel, and list controllers.
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
