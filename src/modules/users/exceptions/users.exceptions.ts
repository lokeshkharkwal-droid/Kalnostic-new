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

// ── User Management v2.0 ──────────────────────────────────────────────────────

/** 409 — username already taken (globally unique login identifier). */
export class UsernameTakenException extends KaltrosException {
  constructor(username: string) {
    super(
      'USERNAME_TAKEN',
      'This username is already taken',
      { username },
      HttpStatus.CONFLICT,
    );
  }
}

/** 422 — date of birth indicates the user is under the minimum age. */
export class UnderageUserException extends KaltrosException {
  constructor(minAge: number) {
    super(
      'USER_UNDERAGE',
      `User must be at least ${minAge} years old`,
      { minAge },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — more than one branch was flagged as the default. */
export class MultipleDefaultBranchException extends KaltrosException {
  constructor() {
    super(
      'MULTIPLE_DEFAULT_BRANCH',
      'Exactly one branch may be marked as the default',
      {},
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — chosen default module is not enabled for the branch. */
export class ModuleNotEnabledForBranchException extends KaltrosException {
  constructor(moduleKey: string, branchId: string) {
    super(
      'MODULE_NOT_ENABLED_FOR_BRANCH',
      `Module '${moduleKey}' is not enabled for this branch`,
      { moduleKey, branchId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — chosen module is not linked to the role template. */
export class ModuleNotInRoleTemplateException extends KaltrosException {
  constructor(moduleKey: string, roleKey: string) {
    super(
      'MODULE_NOT_IN_ROLE_TEMPLATE',
      `Module '${moduleKey}' is not linked to role '${roleKey}'`,
      { moduleKey, roleKey },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — unknown system-module key. */
export class InvalidModuleKeyException extends KaltrosException {
  constructor(moduleKey: string) {
    super(
      'INVALID_MODULE_KEY',
      `Unknown system module '${moduleKey}'`,
      { moduleKey },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 404 — no staff membership for this person in the tenant. */
export class StaffMembershipNotFoundException extends KaltrosException {
  constructor(personId: string, tenantId: string) {
    super(
      'STAFF_MEMBERSHIP_NOT_FOUND',
      'This person is not a staff member of the tenant',
      { personId, tenantId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 422 — attempt to change an immutable field (username, email, user code). */
export class ImmutableFieldException extends KaltrosException {
  constructor(field: string) {
    super(
      'IMMUTABLE_FIELD',
      `Field '${field}' cannot be changed after creation`,
      { field },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — invalid uploaded profile photo (type/size). */
export class InvalidProfilePhotoException extends KaltrosException {
  constructor(reason: string) {
    super(
      'INVALID_PROFILE_PHOTO',
      reason,
      { reason },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
