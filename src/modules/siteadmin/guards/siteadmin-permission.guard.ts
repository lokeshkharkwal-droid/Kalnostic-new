import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import {
  ForbiddenException,
  UnauthorisedException,
} from '../../../common/exceptions/kaltros.exception';
import { SITEADMIN_PERMISSIONS_KEY } from '../decorators/require-siteadmin-permission.decorator';
import {
  SiteAdminPermission,
  siteAdminCan,
} from '../constants/siteadmin-permissions.constant';
import { SiteAdminJwtPayload } from '../types/siteadmin-jwt.type';

/**
 * Validates the SiteAdmin JWT (`'jwt-siteadmin'`) then AND-checks the
 * permissions declared by `@RequireSiteAdminPermission()`. Applied directly on
 * SiteAdmin controllers (not globally). Stores the payload on `req.siteadmin`
 * so it doesn't clash with the business guard's `req.user` (CLAUDE.md §5.2).
 */
@Injectable()
export class SiteAdminPermissionGuard
  extends AuthGuard('jwt-siteadmin')
  implements CanActivate
{
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Step 1 — validate the token signature via the 'jwt-siteadmin' strategy.
    const valid = (await super.canActivate(context)) as boolean;
    if (!valid) {
      throw new UnauthorisedException('SiteAdmin authentication required');
    }

    const request = context.switchToHttp().getRequest<{
      user?: SiteAdminJwtPayload;
      siteadmin?: SiteAdminJwtPayload;
    }>();
    const admin = request.user;
    if (!admin) {
      throw new UnauthorisedException('SiteAdmin authentication required');
    }
    request.siteadmin = admin;

    // Step 2 — permission check (AND logic over all declared permissions).
    const required = this.reflector.getAllAndOverride<SiteAdminPermission[]>(
      SITEADMIN_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }
    for (const permission of required) {
      if (!siteAdminCan(admin.role, permission)) {
        throw new ForbiddenException(permission, 'this SiteAdmin resource');
      }
    }
    return true;
  }

  /** Return our typed exception instead of Passport's default 401. */
  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new UnauthorisedException('Invalid or expired SiteAdmin token');
    }
    return user;
  }
}
