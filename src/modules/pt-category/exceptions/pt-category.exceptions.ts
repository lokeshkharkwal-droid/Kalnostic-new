import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — PT category not found within the tenant/active branch. */
export class PtCategoryNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'PT_CATEGORY_NOT_FOUND',
      'PT category not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active PT category in this branch already uses this name. */
export class PtCategoryNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'PT_CATEGORY_NAME_CONFLICT',
      'A PT category with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 400 — a PT category must map to at least one of a Lab Test List or a Lab Panel
 * List. (The auto-created "General" default is the only unmapped category,
 * created internally — not via this validated path.)
 */
export class PtCategoryMappingRequiredException extends KaltrosException {
  constructor() {
    super(
      'PT_CATEGORY_MAPPING_REQUIRED',
      'Select at least one Lab Test List or Lab Panel List for the PT category',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — the mapped Lab Test List doesn't exist in the active branch. */
export class InvalidPtCategoryLabTestListException extends KaltrosException {
  constructor(id: string) {
    super(
      'INVALID_PT_CATEGORY_LAB_TEST_LIST',
      'The selected Lab Test List is invalid for the active branch',
      { id },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — the mapped Lab Panel List doesn't exist in the active branch. */
export class InvalidPtCategoryLabPanelListException extends KaltrosException {
  constructor(id: string) {
    super(
      'INVALID_PT_CATEGORY_LAB_PANEL_LIST',
      'The selected Lab Panel List is invalid for the active branch',
      { id },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 403 — the auto-created default "General" PT category cannot be edited. It is a
 * fixed, unmapped fallback (it never participates in pricing); users may create
 * other categories instead.
 */
export class CannotModifyGeneralPtCategoryException extends KaltrosException {
  constructor(id: string) {
    super(
      'CANNOT_MODIFY_GENERAL_PT_CATEGORY',
      'The "General" PT category cannot be edited',
      { id },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 400 — the caller has no active branch profile, required for PT category scoping. */
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
