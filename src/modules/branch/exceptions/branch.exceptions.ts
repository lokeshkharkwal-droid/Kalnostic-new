import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — branch not found within the tenant. */
export class BranchNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('BRANCH_NOT_FOUND', 'Branch not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/** 409 — another active branch in this tenant already uses this name. */
export class BranchNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'BRANCH_NAME_CONFLICT',
      'A branch with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 404 — the tenant has not set a main branch yet. */
export class MainBranchNotSetException extends KaltrosException {
  constructor(tenantId: string) {
    super(
      'MAIN_BRANCH_NOT_SET',
      'No main branch has been set for this tenant',
      { tenantId },
      HttpStatus.NOT_FOUND,
    );
  }
}
