import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantContext } from '../../prisma/tenant-context';

/** Minimal shape we read off the authenticated request (business JWT). */
interface MaybeTenantRequest {
  user?: { tenant_id?: string };
}

/**
 * Establishes the per-request tenant context (`AsyncLocalStorage`) from the
 * business JWT's `tenant_id`, so the Prisma RLS extension can scope queries.
 *
 * Runs after the auth guard (so `req.user` is populated). Requests without a
 * business tenant (SiteAdmin, `@Public()`) pass through with no context — the
 * extension then leaves the tenant GUC unset (platform tables aren't under RLS).
 *
 * The handler is subscribed *inside* `tenantContext.run(...)` so the context is
 * active for the whole downstream async flow, including the Prisma calls.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<MaybeTenantRequest>();
    const tenantId = request?.user?.tenant_id;
    if (!tenantId) {
      return next.handle();
    }
    return new Observable((subscriber) => {
      tenantContext.run({ tenantId }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
