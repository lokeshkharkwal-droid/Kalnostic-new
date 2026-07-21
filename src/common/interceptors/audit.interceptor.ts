import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../../modules/audit/audit.service';
import { AuthenticatedRequest } from '../../modules/auth/types/jwt-payload.type';
import { AUDIT_META_KEY, AuditMeta } from '../decorators/audit.decorator';
import { extractClientIp } from '../utils/client-ip.util';

/** The fields we read off the request after business authentication. */
interface MaybeAuthedRequest {
  user?: AuthenticatedRequest['user'];
  body?: unknown;
}

/**
 * Records an `AuditLog` row for any route annotated with `@Audit(...)`, after
 * the handler completes **successfully**. The actor (User/Role), tenant, and
 * active branch are taken from the business JWT; the IP from the request
 * headers. Logging is fire-and-forget — see `AuditService.record`.
 *
 * Routes without `@Audit` metadata, or without an authenticated business user
 * (e.g. `@Public()` / SiteAdmin routes), are passed through untouched: there is
 * no tenant to scope the row to.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Read the route's audit metadata and, when present alongside an authenticated
   * user, emit an audit event once the response stream completes successfully.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(
      AUDIT_META_KEY,
      context.getHandler(),
    );
    if (!meta) {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & MaybeAuthedRequest>();
    const user = request.user;
    if (!user?.tenant_id) {
      return next.handle();
    }

    // Snapshot the human-readable role label from the embedded profiles array.
    const roleLabel =
      user.profiles?.find((p) => p.profile_key === user.active_profile_key)
        ?.profile_label ?? null;
    const ipAddress = extractClientIp(request);

    return next.handle().pipe(
      tap({
        next: () => {
          this.auditService.record({
            tenantId: user.tenant_id,
            branchId: user.active_branch_id,
            module: meta.module,
            action: meta.action,
            description: meta.description,
            actorPersonId: user.person_id,
            actorRoleKey: user.active_profile_key,
            actorRoleLabel: roleLabel,
            ipAddress,
            metadata: meta.captureBody
              ? (request.body as Prisma.InputJsonValue)
              : undefined,
          });
        },
      }),
    );
  }
}
