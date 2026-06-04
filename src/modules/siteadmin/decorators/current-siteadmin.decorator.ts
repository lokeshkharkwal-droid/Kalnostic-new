import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SiteAdminJwtPayload } from '../types/siteadmin-jwt.type';

/**
 * Injects the authenticated SiteAdmin (set on `req.siteadmin` by
 * `SiteAdminPermissionGuard`), or a single field when a key is passed.
 */
export const CurrentSiteAdmin = createParamDecorator(
  (data: keyof SiteAdminJwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ siteadmin?: SiteAdminJwtPayload; user?: SiteAdminJwtPayload }>();
    const admin = request.siteadmin ?? request.user;
    return data ? admin?.[data] : admin;
  },
);
