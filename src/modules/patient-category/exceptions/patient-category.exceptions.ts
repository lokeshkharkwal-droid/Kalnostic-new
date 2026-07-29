import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — patient category not found within the tenant. */
export class PatientCategoryNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'PATIENT_CATEGORY_NOT_FOUND',
      'Patient category not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active category in this tenant already uses this name. */
export class PatientCategoryNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'PATIENT_CATEGORY_NAME_CONFLICT',
      'A patient category with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 409 — attempted to deactivate the tenant's current default category. A
 * default must remain active; set another category as default first.
 */
export class CannotDeactivateDefaultCategoryException extends KaltrosException {
  constructor(id: string) {
    super(
      'CANNOT_DEACTIVATE_DEFAULT_CATEGORY',
      'Cannot deactivate the default category. Set another category as default first.',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — attempted to make an inactive category the tenant's default. */
export class InactiveCategoryCannotBeDefaultException extends KaltrosException {
  constructor(id: string) {
    super(
      'INACTIVE_CATEGORY_CANNOT_BE_DEFAULT',
      'An inactive category cannot be set as default. Activate it first.',
      { id },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — one or more selected lab tests don't exist/aren't active in the active branch. */
export class InvalidLabTestSelectionException extends KaltrosException {
  constructor(ids: string[]) {
    super(
      'INVALID_LAB_TEST_SELECTION',
      'One or more selected lab tests are invalid for the active branch',
      { ids },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — one or more selected lab panels don't exist/aren't active in the active branch. */
export class InvalidLabPanelSelectionException extends KaltrosException {
  constructor(ids: string[]) {
    super(
      'INVALID_LAB_PANEL_SELECTION',
      'One or more selected lab panels are invalid for the active branch',
      { ids },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — the caller has no active branch profile, required for Lab Test/Panel List scoping. */
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
