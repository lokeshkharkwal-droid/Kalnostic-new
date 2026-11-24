import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 401 — vague invalid-credentials error (never reveals which identifier exists). */
export class PatientInvalidCredentialsException extends KaltrosException {
  constructor() {
    super(
      'PATIENT_INVALID_CREDENTIALS',
      'Invalid credentials',
      {},
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/** 423 — patient account locked after too many failed attempts. */
export class PatientAccountLockedException extends KaltrosException {
  constructor(lockedUntil: Date) {
    super(
      'PATIENT_ACCOUNT_LOCKED',
      'Account is temporarily locked due to failed login attempts',
      { lockedUntil: lockedUntil.toISOString() },
      HttpStatus.LOCKED,
    );
  }
}

/** 403 — the underlying person record is inactive. */
export class PatientAccountInactiveException extends KaltrosException {
  constructor(personId: string) {
    super(
      'PATIENT_ACCOUNT_INACTIVE',
      'This account is inactive',
      { personId },
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * 403 — authenticated identity has no patient record at any business (no
 * portal access). Staff must enable login via the credential-issuance endpoint.
 */
export class PatientNoLoginAccessException extends KaltrosException {
  constructor(personId: string) {
    super(
      'PATIENT_NO_LOGIN_ACCESS',
      'This account is not enrolled for patient-portal access',
      { personId },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 401 — bootstrap token missing, malformed, wrong type, or expired. */
export class PatientInvalidBootstrapTokenException extends KaltrosException {
  constructor() {
    super(
      'PATIENT_INVALID_BOOTSTRAP_TOKEN',
      'Invalid or expired login session. Please log in again.',
      {},
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/** 403 — chosen tenant is not one the person is a patient of. */
export class PatientTenantNotSelectableException extends KaltrosException {
  constructor(tenantId: string) {
    super(
      'PATIENT_TENANT_NOT_SELECTABLE',
      'You do not have patient access at the selected business',
      { tenantId },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 401 — refresh token missing, used, revoked, expired, or not a patient token. */
export class PatientInvalidRefreshTokenException extends KaltrosException {
  constructor() {
    super(
      'PATIENT_INVALID_REFRESH_TOKEN',
      'Invalid or expired refresh token',
      {},
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/** 403 — temp-password session tried to reach a route other than change-password. */
export class PatientPasswordChangeRequiredException extends KaltrosException {
  constructor() {
    super(
      'PATIENT_PASSWORD_CHANGE_REQUIRED',
      'You must set a new password before continuing',
      {},
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * 422 — cannot enable login because the patient has no usable identifier
 * (no mobile and no email to log in with).
 */
export class PatientHasNoLoginIdentifierException extends KaltrosException {
  constructor(patientId: string) {
    super(
      'PATIENT_HAS_NO_LOGIN_IDENTIFIER',
      'Patient has no mobile or email to use as a login identifier',
      { patientId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
