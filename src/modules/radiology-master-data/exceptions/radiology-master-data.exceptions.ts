import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — radiology master data not found within the tenant. */
export class RadiologyMasterDataNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'RADIOLOGY_MASTER_DATA_NOT_FOUND',
      'Radiology master data not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active radiology master data on this branch already uses this name. */
export class RadiologyMasterDataNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'RADIOLOGY_MASTER_DATA_NAME_CONFLICT',
      'A radiology master data with this name already exists on this branch',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — a branch maps to exactly one radiology master data; it already has one. */
export class BranchAlreadyHasRadiologyMasterDataException extends KaltrosException {
  constructor(branchId: string) {
    super(
      'BRANCH_ALREADY_HAS_RADIOLOGY_MASTER_DATA',
      'This branch already has a radiology master data. A branch maps to exactly one radiology master data.',
      { branchId },
      HttpStatus.CONFLICT,
    );
  }
}

/** 404 — no radiology master data is mapped to the given branch. */
export class RadiologyMasterDataNotMappedToBranchException extends KaltrosException {
  constructor(branchId: string) {
    super(
      'RADIOLOGY_MASTER_DATA_NOT_MAPPED_TO_BRANCH',
      'No radiology master data is mapped to this branch.',
      { branchId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — radiology master data belonging to the main branch cannot be deleted. */
export class CannotDeleteMainBranchRadiologyMasterDataException extends KaltrosException {
  constructor(id: string) {
    super(
      'CANNOT_DELETE_MAIN_BRANCH_RADIOLOGY_MASTER_DATA',
      "The main branch's radiology master data cannot be deleted.",
      { id },
      HttpStatus.CONFLICT,
    );
  }
}
