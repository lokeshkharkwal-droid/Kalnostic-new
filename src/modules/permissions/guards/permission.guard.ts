import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import {
  BUSINESS_ANY_PERMISSIONS_KEY,
  BUSINESS_PERMISSIONS_KEY,
} from '../decorators/require-permission.decorator';
import {
  PermissionCheckService,
  contextFromJwt,
} from '../services/permission-check.service';

/**
 * Business permission guard (opt-in, per-route). Runs **after** the global
 * `JwtAuthGuard`, so `req.user` is already populated. Reads the keys declared by
 * `@RequirePermission(...)` and delegates to {@link PermissionCheckService} —
 * the same evaluator controllers use for request-dependent checks, so route- and
 * service-level enforcement always agree.
 *
 * Rollout controls (owned by PermissionCheckService): unannotated routes are
 * always allowed; `business_admin` / `administrator` bypass; `RBAC_ENFORCE=false`
 * makes it log-only.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionCheck: PermissionCheckService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      BUSINESS_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAny = this.reflector.getAllAndOverride<string[]>(
      BUSINESS_ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const hasAll = required && required.length > 0;
    const hasAny = requiredAny && requiredAny.length > 0;
    if (!hasAll && !hasAny) {
      return true; // opt-in: unannotated routes are never gated
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) {
      return true; // @Public route (JwtAuthGuard let it through) — nothing to gate
    }

    const ctx = contextFromJwt(user);
    // AND-check the required keys, then (separately) the "any of" keys. A route
    // uses one form or the other; both must pass when both are present.
    if (hasAll) {
      await this.permissionCheck.enforce(ctx, required, 'all');
    }
    if (hasAny) {
      await this.permissionCheck.enforce(ctx, requiredAny, 'any');
    }
    return true;
  }
}
