import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — role not found among this tenant's roles or the global system roles. */
export class RoleNotFoundException extends KaltrosException {
  constructor(idOrKey: string) {
    super(
      'ROLE_NOT_FOUND',
      'Role not found',
      { idOrKey },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active role in this scope already uses this name. */
export class RoleNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'ROLE_NAME_CONFLICT',
      'A role with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 403 — attempt to rename/re-scope or delete a seeded system role. System roles
 * are immutable (only `description` and `isActive` may change); their `name`,
 * `key`, and branch matrix are fixed in code (see PROFILE_REGISTRY).
 */
export class SystemRoleImmutableException extends KaltrosException {
  constructor(key: string) {
    super(
      'SYSTEM_ROLE_IMMUTABLE',
      'System roles cannot be renamed or deleted',
      { key },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 409 — the role is still assigned to one or more active users. */
export class RoleInUseException extends KaltrosException {
  constructor(id: string, assignments: number) {
    super(
      'ROLE_IN_USE',
      'This role is still assigned to active users and cannot be deleted',
      { id, assignments },
      HttpStatus.CONFLICT,
    );
  }
}
