import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — person not found. */
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

/** 409 — phone already registered (global de-dup key). */
export class PersonPhoneTakenException extends KaltrosException {
  constructor(phone: string) {
    super(
      'PERSON_PHONE_TAKEN',
      'A person with this phone number already exists',
      { phone },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — email already registered (global de-dup key). */
export class PersonEmailTakenException extends KaltrosException {
  constructor(email: string) {
    super(
      'PERSON_EMAIL_TAKEN',
      'A person with this email already exists',
      { email },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — profile already assigned at this branch. */
export class ProfileAlreadyAssignedException extends KaltrosException {
  constructor(personId: string, branchId: string, profileKey: string) {
    super(
      'PROFILE_ALREADY_ASSIGNED',
      'This profile is already assigned at this branch',
      { personId, branchId, profileKey },
      HttpStatus.CONFLICT,
    );
  }
}

/** 422 — profile is not valid for the branch type (or registry). */
export class ProfileInvalidForBranchException extends KaltrosException {
  constructor(profileKey: string, branchType: string) {
    super(
      'PROFILE_INVALID_FOR_BRANCH',
      `Profile '${profileKey}' is not valid for branch type '${branchType}'`,
      { profileKey, branchType },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 404 — profile assignment not found. */
export class ProfileNotFoundException extends KaltrosException {
  constructor(personId: string, branchId: string) {
    super(
      'PROFILE_NOT_FOUND',
      'Profile assignment not found',
      { personId, branchId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 403 — caller's tenant does not own this person's basic details. */
export class NotOwnerTenantException extends KaltrosException {
  constructor(tenantId: string, personId: string) {
    super(
      'NOT_OWNER_TENANT',
      'Only the owning tenant may edit this person',
      { tenantId, personId },
      HttpStatus.FORBIDDEN,
    );
  }
}
