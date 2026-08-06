import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch lab test list not found within the tenant/branch. */
export class BranchLabTestListNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_LAB_TEST_LIST_NOT_FOUND',
      'Lab test list not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active list in this branch already uses this name. */
export class BranchLabTestListNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'BRANCH_LAB_TEST_LIST_NAME_CONFLICT',
      'A lab test list with this name already exists in this branch',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — the default Walk-in list cannot be deleted. */
export class DefaultBranchLabTestListNotDeletableException extends KaltrosException {
  constructor() {
    super(
      'DEFAULT_LAB_TEST_LIST_NOT_DELETABLE',
      'The default Walk-in lab test list cannot be deleted',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}
