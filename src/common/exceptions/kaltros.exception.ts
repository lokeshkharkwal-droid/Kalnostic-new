import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base exception for all Kalnostics application errors (CLAUDE.md rule #6,
 * adopted from kaltros-master).
 *
 * Every module defines its own exception classes that extend this, so all
 * errors carry:
 *  - a machine-readable `errorCode` (SCREAMING_SNAKE_CASE) for the frontend
 *  - a human-readable `message` shown to the user
 *  - a `context` object for backend debugging — logged server-side, NEVER sent
 *    to the client
 *  - a consistent HTTP status code
 *
 * The HttpException body is `{ success: false, error: { code, message } }`,
 * which the global exception filter sends as-is.
 *
 * @example
 *   throw new KaltrosException('TENANT_NOT_FOUND', 'Tenant not found', { id }, 404)
 */
export class KaltrosException extends HttpException {
  /** Machine-readable error code. Format: MODULE_DESCRIPTION in SCREAMING_SNAKE_CASE. */
  public readonly errorCode: string;

  /** Extra context for debugging — logged server-side, not returned to the client. */
  public readonly context: Record<string, unknown>;

  constructor(
    errorCode: string,
    message: string,
    context: Record<string, unknown> = {},
    statusCode: number = HttpStatus.BAD_REQUEST,
  ) {
    super(
      { success: false, error: { code: errorCode, message } },
      statusCode,
    );
    this.errorCode = errorCode;
    this.context = context;
  }
}

// ── Common reusable exceptions ────────────────────────────────────────────────
// Prefer module-specific exceptions; these cover truly generic cases.

/** 404 — a named resource could not be found. */
export class NotFoundException extends KaltrosException {
  constructor(resource: string, id: string) {
    super(
      `${resource.toUpperCase().replace(/-/g, '_')}_NOT_FOUND`,
      `${resource} not found`,
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 401 — authentication required or failed. */
export class UnauthorisedException extends KaltrosException {
  constructor(reason = 'Authentication required') {
    super('UNAUTHORISED', reason, {}, HttpStatus.UNAUTHORIZED);
  }
}

/** 403 — authenticated but not allowed to perform the action. */
export class ForbiddenException extends KaltrosException {
  constructor(action: string, resource: string) {
    super(
      'FORBIDDEN',
      `You do not have permission to ${action} ${resource}`,
      { action, resource },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 422 — semantic validation failure beyond what the DTO pipe catches. */
export class ValidationException extends KaltrosException {
  constructor(message: string, fields: Record<string, string> = {}) {
    super('VALIDATION_ERROR', message, { fields }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** 409 — uniqueness / state conflict. */
export class ConflictException extends KaltrosException {
  constructor(errorCode: string, message: string, context: Record<string, unknown> = {}) {
    super(errorCode, message, context, HttpStatus.CONFLICT);
  }
}

/** 500 — unexpected failure. The operation name aids log triage. */
export class InternalException extends KaltrosException {
  constructor(operation: string, context: Record<string, unknown> = {}) {
    super(
      'INTERNAL_ERROR',
      'An unexpected error occurred. Please try again or contact support.',
      { operation, ...context },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
