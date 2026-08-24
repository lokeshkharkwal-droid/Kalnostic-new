import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '../../../common/exceptions/kaltros.exception';
import { REQUIRE_PROFILE_KEY } from '../decorators/require-profile.decorator';
import { AuthenticatedRequest } from '../types/jwt-payload.type';

/**
 * AND-checks the caller's `active_profile_key` against `@RequireProfile(...)`.
 * Runs after the global `JwtAuthGuard` (which populates `request.user`), so
 * `request.user.active_profile_key` is always available here. No-op when the
 * route declares no required profiles.
 */
@Injectable()
export class ProfileGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PROFILE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const activeProfile = request.user?.active_profile_key;

    if (!activeProfile || !required.includes(activeProfile)) {
      throw new ForbiddenException('create', 'this resource');
    }
    return true;
  }
}
