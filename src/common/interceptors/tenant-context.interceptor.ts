import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantContext, TenantContextStore } from '../../prisma/tenant-context';
import { B2B_ROLE_KEY } from '../guards/b2b.constants';

/** Minimal shape we read off the authenticated request (business JWT). */
interface MaybeTenantRequest {
  user?: {
    tenant_id?: string;
    active_profile_key?: string | null;
    referral_panel_id?: string | null;
  };
}

/**
 * Establishes the per-request tenant context (`AsyncLocalStorage`) from the
 * business JWT's `tenant_id`, so the Prisma RLS extension can scope queries.
 *
 * Runs after the auth guard (so `req.user` is populated). Requests without a
 * business tenant (SiteAdmin, `@Public()`) pass through with no context — the
 * extension then leaves the tenant GUC unset (platform tables aren't under RLS).
 *
 * For B2B Referring Panel sessions it also stashes the token's
 * `referral_panel_id` in the store, so the order/invoice/payment/report services
 * can force per-panel isolation. This is done *here* (not in a guard) because
 * NestJS runs guards before interceptors, so the AsyncLocalStorage store is only
 * created at this point — a guard could not persist into it.
 *
 * The handler is subscribed *inside* `tenantContext.run(...)` so the context is
 * active for the whole downstream async flow, including the Prisma calls.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<MaybeTenantRequest>();
    const user = request?.user;
    const tenantId = user?.tenant_id;
    if (!tenantId) {
      return next.handle();
    }

    const store: TenantContextStore = { tenantId };
    if (user?.active_profile_key === B2B_ROLE_KEY) {
      if (!user.referral_panel_id) {
        throw new ForbiddenException(
          'B2B session is missing its referral panel context.',
        );
      }
      store.referralPanelId = user.referral_panel_id;
    }

    return new Observable((subscriber) => {
      tenantContext.run(store, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
