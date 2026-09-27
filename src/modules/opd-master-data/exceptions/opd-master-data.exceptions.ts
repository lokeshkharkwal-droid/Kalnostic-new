import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — opd master data not found within the tenant. */
export class OpdMasterDataNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'OPD_MASTER_DATA_NOT_FOUND',
      'Opd master data not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active opd master data on this branch already uses this name. */
export class OpdMasterDataNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'OPD_MASTER_DATA_NAME_CONFLICT',
      'A opd master data with this name already exists on this branch',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — a branch maps to exactly one opd master data; it already has one. */
export class BranchAlreadyHasOpdMasterDataException extends KaltrosException {
  constructor(branchId: string) {
    super(
      'BRANCH_ALREADY_HAS_OPD_MASTER_DATA',
      'This branch already has a opd master data. A branch maps to exactly one opd master data.',
      { branchId },
      HttpStatus.CONFLICT,
    );
  }
}

/** 404 — no opd master data is mapped to the given branch. */
export class OpdMasterDataNotMappedToBranchException extends KaltrosException {
  constructor(branchId: string) {
    super(
      'OPD_MASTER_DATA_NOT_MAPPED_TO_BRANCH',
      'No opd master data is mapped to this branch.',
      { branchId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — opd master data belonging to the main branch cannot be deleted. */
export class CannotDeleteMainBranchOpdMasterDataException extends KaltrosException {
  constructor(id: string) {
    super(
      'CANNOT_DELETE_MAIN_BRANCH_OPD_MASTER_DATA',
      "The main branch's opd master data cannot be deleted.",
      { id },
      HttpStatus.CONFLICT,
    );
  }
}
