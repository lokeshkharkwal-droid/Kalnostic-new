import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch radiology test not found within the tenant/branch. */
export class BranchRadiologyTestNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_RADIOLOGY_TEST_NOT_FOUND',
      'Branch radiology test not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active branch radiology test already uses this name. */
export class BranchRadiologyTestNameConflictException extends KaltrosException {
  constructor(testName: string) {
    super(
      'BRANCH_RADIOLOGY_TEST_NAME_CONFLICT',
      'A branch radiology test with this name already exists',
      { testName },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active branch radiology test already uses this code. */
export class BranchRadiologyTestCodeConflictException extends KaltrosException {
  constructor(testCode: string) {
    super(
      'BRANCH_RADIOLOGY_TEST_CODE_CONFLICT',
      'A branch radiology test with this code already exists',
      { testCode },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — a variant group already has an active default (one default per source). */
export class BranchRadiologyTestDefaultConflictException extends KaltrosException {
  constructor() {
    super(
      'BRANCH_RADIOLOGY_TEST_DEFAULT_CONFLICT',
      'This test already has a default variant in the branch list',
      {},
      HttpStatus.CONFLICT,
    );
  }
}
