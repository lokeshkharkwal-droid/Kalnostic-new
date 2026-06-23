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

/** 409 — the main branch cannot be soft-deleted while it is the main branch. */
export class CannotDeleteMainBranchException extends KaltrosException {
  constructor(id: string) {
    super(
      'CANNOT_DELETE_MAIN_BRANCH',
      'The main branch cannot be deleted. Set another branch as main (or deactivate it) first.',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — the target branch is not a Collection Center, so it cannot map receivers. */
export class NotACollectionCenterException extends KaltrosException {
  constructor(id: string) {
    super(
      'NOT_A_COLLECTION_CENTER',
      'This branch is not a Collection Center',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 409 — a branch cannot be mapped as a sample receiver because it is the
 * Collection Center itself or is itself another Collection Center.
 */
export class InvalidReceivingBranchException extends KaltrosException {
  constructor(receivingBranchId: string, reason: string) {
    super(
      'INVALID_RECEIVING_BRANCH',
      'This branch cannot receive samples from the collection center',
      { receivingBranchId, reason },
      HttpStatus.CONFLICT,
    );
  }
}
