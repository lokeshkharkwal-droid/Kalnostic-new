import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 401 — vague invalid-credentials error (doesn't reveal which identifier exists). */
export class InvalidCredentialsException extends KaltrosException {
  constructor() {
    super(
      'INVALID_CREDENTIALS',
      'Invalid credentials',
      {},
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/** 423 — account locked after too many failed attempts. */
export class AccountLockedException extends KaltrosException {
  constructor(lockedUntil: Date) {
    super(
      'ACCOUNT_LOCKED',
      'Account is temporarily locked due to failed login attempts',
      { lockedUntil: lockedUntil.toISOString() },
      HttpStatus.LOCKED,
    );
  }
}

/** 403 — the person record is inactive. */
export class AccountInactiveException extends KaltrosException {
  constructor(personId: string) {
    super(
      'ACCOUNT_INACTIVE',
      'This account is inactive',
      { personId },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 401 — refresh token missing, used, revoked, or expired. */
export class InvalidRefreshTokenException extends KaltrosException {
  constructor() {
    super(
      'INVALID_REFRESH_TOKEN',
      'Invalid or expired refresh token',
      {},
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/** 403 — attempted to switch to a profile the user doesn't hold. */
export class ProfileSwitchDeniedException extends KaltrosException {
  constructor(branchId: string, profileKey: string) {
    super(
      'PROFILE_SWITCH_DENIED',
      'You do not have an active assignment for that profile',
      { branchId, profileKey },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 422 — new password fails the policy. */
export class InvalidPasswordException extends KaltrosException {
  constructor(reason: string) {
    super('INVALID_PASSWORD', reason, {}, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/**
 * 403 — a patient-only identity (a patient record with no staff identity) tried
 * to authenticate through business auth. It must use the patient portal; this
 * stops a patient credential row minting a business token that the global guard
 * would accept on staff routes (business RBAC isn't route-enforced yet).
 */
export class BusinessLoginNotAllowedForPatientException extends KaltrosException {
  constructor(personId: string) {
    super(
      'BUSINESS_LOGIN_NOT_ALLOWED_FOR_PATIENT',
      'This account can only sign in through the patient portal',
      { personId },
      HttpStatus.FORBIDDEN,
    );
  }
}
