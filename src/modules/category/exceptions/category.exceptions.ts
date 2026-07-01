import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — category not found within the tenant. */
export class CategoryNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'CATEGORY_NOT_FOUND',
      'Category not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active category in this tenant already uses this name. */
export class CategoryNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'CATEGORY_NAME_CONFLICT',
      'A category with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 409 — another active category in the same scope already uses this short name
 * (within the parent department for UNDER_DEPARTMENT; per tenant for
 * INDEPENDENT).
 */
export class CategoryShortNameConflictException extends KaltrosException {
  constructor(shortName: string) {
    super(
      'CATEGORY_SHORT_NAME_CONFLICT',
      'A category with this short name already exists',
      { shortName },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 400 — a person mapping's priority is out of range. Priority must be between 1
 * and the tenant's total active person-mapping count (inclusive).
 */
export class InvalidCategoryPriorityException extends KaltrosException {
  constructor(priority: number, max: number) {
    super(
      'INVALID_CATEGORY_PRIORITY',
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
 * 404 — a mapping's `personId` does not resolve to an active row in the table its
 * `type` points at (USER → persons, CONSULTANT_DOCTOR/REPORTING_DOCTOR → doctors
 * with a matching doctorType, EXTERNAL_REFERRAL → external_referrals).
 */
export class InvalidPersonMappingReferenceException extends KaltrosException {
  constructor(type: string, personId: string) {
    super(
      'INVALID_PERSON_MAPPING_REFERENCE',
      'The mapped party does not exist for the supplied type',
      { type, personId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 400 — categoryType is UNDER_DEPARTMENT but no `departmentId` was supplied.
 * (A bad/foreign departmentId surfaces as DepartmentNotFoundException instead.)
 */
export class CategoryDepartmentRequiredException extends KaltrosException {
  constructor() {
    super(
      'CATEGORY_DEPARTMENT_REQUIRED',
      'An "Under Department" category must reference a department',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** 400 — categoryType is INDEPENDENT but a `departmentId` was supplied. */
export class IndependentCategoryDepartmentException extends KaltrosException {
  constructor() {
    super(
      'INDEPENDENT_CATEGORY_DEPARTMENT',
      'An "Independent" category must not reference a department',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}
