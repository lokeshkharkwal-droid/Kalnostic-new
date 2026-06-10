import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — sub-category not found within the tenant. */
export class SubCategoryNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'SUB_CATEGORY_NOT_FOUND',
      'Sub-category not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active sub-category in this tenant already uses this name. */
export class SubCategoryNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'SUB_CATEGORY_NAME_CONFLICT',
      'A sub-category with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 409 — another active sub-category in the same scope already uses this short
 * name (within the parent category for UNDER_CATEGORY; within the parent
 * department for UNDER_DEPARTMENT; per tenant for INDEPENDENT).
 */
export class SubCategoryShortNameConflictException extends KaltrosException {
  constructor(shortName: string) {
    super(
      'SUB_CATEGORY_SHORT_NAME_CONFLICT',
      'A sub-category with this short name already exists',
      { shortName },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 400 — a person mapping's priority is out of range. Priority must be between 1
 * and the tenant's total active person-mapping count (inclusive).
 */
export class InvalidSubCategoryPriorityException extends KaltrosException {
  constructor(priority: number, max: number) {
    super(
      'INVALID_SUB_CATEGORY_PRIORITY',
      `Priority must be between 1 and ${max}`,
      { priority, max },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 409 — more than one default person was supplied for the same position. */
export class DuplicateDefaultPositionException extends KaltrosException {
  constructor(position: string) {
    super(
      'DUPLICATE_DEFAULT_POSITION',
      'Only one default person is allowed per position',
      { position },
      HttpStatus.CONFLICT,
    );
  }
}

/** 404 — a person referenced by a mapping does not exist (or is soft-deleted). */
export class PersonNotFoundException extends KaltrosException {
  constructor(personId: string) {
    super(
      'PERSON_NOT_FOUND',
      'Person not found',
      { personId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 400 — subCategoryType is UNDER_DEPARTMENT but no `departmentId` was supplied.
 * (A bad/foreign departmentId surfaces as DepartmentNotFoundException instead.)
 */
export class SubCategoryDepartmentRequiredException extends KaltrosException {
  constructor() {
    super(
      'SUB_CATEGORY_DEPARTMENT_REQUIRED',
      'An "Under Department" sub-category must reference a department',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — subCategoryType is UNDER_CATEGORY but no `categoryId` was supplied.
 * (A bad/foreign categoryId surfaces as CategoryNotFoundException instead.)
 */
export class SubCategoryCategoryRequiredException extends KaltrosException {
  constructor() {
    super(
      'SUB_CATEGORY_CATEGORY_REQUIRED',
      'An "Under Category" sub-category must reference a category',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — subCategoryType is INDEPENDENT but a parent id was supplied. */
export class IndependentSubCategoryParentException extends KaltrosException {
  constructor() {
    super(
      'INDEPENDENT_SUB_CATEGORY_PARENT',
      'An "Independent" sub-category must not reference a department or category',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}
