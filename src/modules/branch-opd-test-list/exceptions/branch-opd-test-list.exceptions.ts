import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch opd test list not found within the tenant/branch. */
export class BranchOpdTestListNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'BRANCH_OPD_TEST_LIST_NOT_FOUND',
      'Opd test list not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active list in this branch already uses this name. */
export class BranchOpdTestListNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'BRANCH_OPD_TEST_LIST_NAME_CONFLICT',
      'A opd test list with this name already exists in this branch',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — the default Walk-in list cannot be deleted. */
export class DefaultBranchOpdTestListNotDeletableException extends KaltrosException {
  constructor() {
    super(
      'DEFAULT_OPD_TEST_LIST_NOT_DELETABLE',
      'The default Walk-in opd test list cannot be deleted',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}
