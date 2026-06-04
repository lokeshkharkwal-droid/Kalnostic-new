import { SetMetadata } from '@nestjs/common';
import { SiteAdminPermission } from '../constants/siteadmin-permissions.constant';

/** Metadata key the SiteAdminPermissionGuard reads. */
export const SITEADMIN_PERMISSIONS_KEY = 'siteadminPermissions';

/**
 * Declares the SiteAdmin permissions required for a route. The guard AND-checks
 * all of them against the token's role.
 *
 * ```ts
 * @RequireSiteAdminPermission(SITE_ADMIN_PERM.BUSINESS_CREATE)
 * ```
 */
export const RequireSiteAdminPermission = (
  ...permissions: SiteAdminPermission[]
) => SetMetadata(SITEADMIN_PERMISSIONS_KEY, permissions);
