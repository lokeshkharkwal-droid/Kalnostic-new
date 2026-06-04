import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — siteadmin user not found. */
export class SiteAdminNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('SITEADMIN_NOT_FOUND', 'SiteAdmin user not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/** 409 — email already in use by another siteadmin. */
export class SiteAdminEmailTakenException extends KaltrosException {
  constructor(email: string) {
    super(
      'SITEADMIN_EMAIL_TAKEN',
      'A SiteAdmin with this email already exists',
      { email },
      HttpStatus.CONFLICT,
    );
  }
}

/** 401 — vague invalid-credentials error for siteadmin login. */
export class SiteAdminInvalidCredentialsException extends KaltrosException {
  constructor() {
    super('SITEADMIN_INVALID_CREDENTIALS', 'Invalid credentials', {}, HttpStatus.UNAUTHORIZED);
  }
}

/** 423 — siteadmin account locked after failed attempts. */
export class SiteAdminAccountLockedException extends KaltrosException {
  constructor(lockedUntil: Date) {
    super(
      'SITEADMIN_ACCOUNT_LOCKED',
      'Account is temporarily locked due to failed login attempts',
      { lockedUntil: lockedUntil.toISOString() },
      HttpStatus.LOCKED,
    );
  }
}

/** 403 — the super_owner cannot be created via API, demoted, or deactivated. */
export class SiteAdminCannotModifySuperOwnerException extends KaltrosException {
  constructor() {
    super(
      'SITEADMIN_CANNOT_MODIFY_SUPER_OWNER',
      'The super_owner account cannot be created, demoted, or deactivated',
      {},
      HttpStatus.FORBIDDEN,
    );
  }
}
