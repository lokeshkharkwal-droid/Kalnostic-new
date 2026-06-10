import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — department not found within the tenant. */
export class DepartmentNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'DEPARTMENT_NOT_FOUND',
      'Department not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active department in this tenant already uses this name. */
export class DepartmentNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'DEPARTMENT_NAME_CONFLICT',
      'A department with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — another active department in this tenant already uses this short name. */
export class DepartmentShortNameConflictException extends KaltrosException {
  constructor(shortName: string) {
    super(
      'DEPARTMENT_SHORT_NAME_CONFLICT',
      'A department with this short name already exists',
      { shortName },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 400 — a person mapping's priority is out of range. Priority must be between 1
 * and the tenant's total active person-mapping count (inclusive).
 */
export class InvalidDepartmentPriorityException extends KaltrosException {
  constructor(priority: number, max: number) {
    super(
      'INVALID_DEPARTMENT_PRIORITY',
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
