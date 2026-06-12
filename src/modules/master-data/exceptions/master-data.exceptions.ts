import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — master data not found within the tenant. */
export class MasterDataNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'MASTER_DATA_NOT_FOUND',
      'Master data not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active master data on this branch already uses this name. */
export class MasterDataNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'MASTER_DATA_NAME_CONFLICT',
      'A master data with this name already exists on this branch',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — the main branch may have only its single auto-created master data. */
export class CannotCreateMasterDataForMainBranchException extends KaltrosException {
  constructor(branchId: string) {
    super(
      'CANNOT_CREATE_MASTER_DATA_FOR_MAIN_BRANCH',
      'The main branch may have only one master data; additional master data cannot be created for it.',
      { branchId },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — master data belonging to the main branch cannot be deleted. */
export class CannotDeleteMainBranchMasterDataException extends KaltrosException {
  constructor(id: string) {
    super(
      'CANNOT_DELETE_MAIN_BRANCH_MASTER_DATA',
      "The main branch's master data cannot be deleted.",
      { id },
      HttpStatus.CONFLICT,
    );
  }
}
