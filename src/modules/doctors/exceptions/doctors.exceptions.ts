import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — doctor not found within the tenant. */
export class DoctorNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('DOCTOR_NOT_FOUND', 'Doctor not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/**
 * 409 — another active doctor in this tenant already uses this registration
 * number (per-tenant de-duplication key among active rows).
 */
export class DuplicateRegistrationNoException extends KaltrosException {
  constructor(registrationNo: string) {
    super(
      'DUPLICATE_REGISTRATION_NO',
      'A doctor with this registration number already exists',
      { registrationNo },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — the submitted branch assignments mark more than one branch as primary.
 * A doctor may have at most one primary branch.
 */
export class MultiplePrimaryBranchAssignmentsException extends KaltrosException {
  constructor(primaryCount: number) {
    super(
      'MULTIPLE_PRIMARY_BRANCH_ASSIGNMENTS',
      'A doctor can have at most one primary branch assignment',
      { primaryCount },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — the same branch appears more than once in the submitted branch
 * assignments. Each branch may be assigned to a doctor only once.
 */
export class DuplicateBranchAssignmentException extends KaltrosException {
  constructor(branchId: string) {
    super(
      'DUPLICATE_BRANCH_ASSIGNMENT',
      'A branch can be assigned to a doctor only once',
      { branchId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
