import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — outsource center not found within the tenant. */
export class OutsourceCenterNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'OUTSOURCE_CENTER_NOT_FOUND',
      'Outsource center not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active outsource center in this tenant already uses this name. */
export class OutsourceCenterNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'OUTSOURCE_CENTER_NAME_CONFLICT',
      'An outsource center with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 422 — a center must be assigned to at least one branch. */
export class OutsourceCenterNoBranchException extends KaltrosException {
  constructor() {
    super(
      'OUTSOURCE_CENTER_NO_BRANCH',
      'An outsource center must be assigned to at least one branch',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 400 — the same branch was assigned more than once. */
export class DuplicateBranchAssignmentException extends KaltrosException {
  constructor(branchId: string) {
    super(
      'OUTSOURCE_CENTER_DUPLICATE_BRANCH',
      'A branch can only be assigned once to an outsource center',
      { branchId },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — an assigned branch selected neither a lab test nor a lab panel. At least
 * one test or panel is required per assigned branch.
 */
export class MissingSelectionException extends KaltrosException {
  constructor(branchId: string) {
    super(
      'OUTSOURCE_CENTER_MISSING_SELECTION',
      'Each assigned branch must select at least one lab test or lab panel',
      { branchId },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — the same contact role was provided more than once for a center. */
export class DuplicateContactRoleException extends KaltrosException {
  constructor(role: string) {
    super(
      'OUTSOURCE_CENTER_DUPLICATE_CONTACT_ROLE',
      'Each contact role can be provided at most once',
      { role },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — one or more selected lab tests are not active lab tests on the branch they
 * were chosen for (wrong branch, soft-deleted, inactive, or non-existent).
 */
export class InvalidTestForBranchException extends KaltrosException {
  constructor(branchId: string, labTestIds: string[]) {
    super(
      'OUTSOURCE_CENTER_INVALID_TEST',
      'One or more selected lab tests are not valid for this branch',
      { branchId, labTestIds },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — one or more selected lab panels are not active lab panels on the branch
 * they were chosen for (wrong branch, soft-deleted, inactive, or non-existent).
 */
export class InvalidPanelForBranchException extends KaltrosException {
  constructor(branchId: string, labPanelIds: string[]) {
    super(
      'OUTSOURCE_CENTER_INVALID_PANEL',
      'One or more selected lab panels are not valid for this branch',
      { branchId, labPanelIds },
      HttpStatus.BAD_REQUEST,
    );
  }
}
