import { SetMetadata } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';

/** Reflector metadata key under which `@Audit(...)` stores its config. */
export const AUDIT_META_KEY = 'audit:meta';

/**
 * Declarative description of the audit event a route emits. Attached to a
 * handler with `@Audit(...)` and read by `AuditInterceptor` after the request
 * succeeds (see `common/interceptors/audit.interceptor.ts`).
 */
export interface AuditMeta {
  /** Functional area this action belongs to (the "Module" column). */
  module: AuditModule;
  /** The kind of operation. Defaults to `OTHER` when omitted. */
  action?: AuditAction;
  /** Human-readable summary of what the user performed. */
  description: string;
}

/**
 * Marks a controller route for audit logging. The global `AuditInterceptor`
 * reads this metadata and, on a successful response, records an `AuditLog`
 * row with the caller's identity, role, IP, and the given module/description.
 *
 * Unannotated routes (and any route without an authenticated business user)
 * are never logged.
 *
 * @example
 *   @Audit({ module: AuditModule.BRANCH, action: AuditAction.CREATE,
 *            description: 'Created a branch' })
 *   @Post()
 *   create(...) {}
 *
 * @param meta the module, action, and description for this route
 */
export const Audit = (meta: AuditMeta): MethodDecorator =>
  SetMetadata(AUDIT_META_KEY, meta);
