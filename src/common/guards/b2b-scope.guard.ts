import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtPayload } from '../../modules/auth/types/jwt-payload.type';
import { tenantContext } from '../../prisma/tenant-context';
import { B2B_ROLE_KEY } from './b2b.constants';

/**
 * Writes the active B2B session's referral panel id into the per-request tenant
 * context so order/invoice/payment/report services can force per-panel isolation.
 * A complete no-op for every non-B2B session. Registered globally, after
 * JwtAuthGuard and TenantContextInterceptor (so `req.user` and the store exist).
 */
@Injectable()
export class B2bScopeGuard implements CanActivate {
  /**
   * @param context the current execution context (HTTP)
   * @returns always true (this guard only writes context; it never blocks)
   */
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = req.user;
    if (!user || user.active_profile_key !== B2B_ROLE_KEY) return true;

    if (!user.referral_panel_id) {
      throw new ForbiddenException(
        'B2B session is missing its referral panel context.',
      );
    }
    const store = tenantContext.getStore();
    if (store) store.referralPanelId = user.referral_panel_id;
    return true;
  }
}
