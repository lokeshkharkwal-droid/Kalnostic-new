import { SiteAdminRole } from '@prisma/client';

/**
 * SiteAdmin permission keys (distinct from business-user permissions), used by
 * `@RequireSiteAdminPermission()`. Roles are cumulative (CLAUDE.md §5.2).
 */
export const SITE_ADMIN_PERM = {
  // content_admin and above
  MASTER_DATA_READ: 'master-data:read',
  MASTER_DATA_WRITE: 'master-data:write',
  // operations_admin and above
  BUSINESS_CREATE: 'business:create',
  BUSINESS_READ: 'business:read',
  BUSINESS_SUSPEND: 'business:suspend',
  BUSINESS_REACTIVATE: 'business:reactivate',
  AUDIT_LOGS_READ: 'audit-logs:read',
  REPORTS_OPERATIONAL: 'reports:operational',
  // full_admin and above
  REPORTS_FINANCE: 'reports:finance',
  PAYMENT_RULES_READ: 'payment-rules:read',
  PAYMENT_RULES_WRITE: 'payment-rules:write',
  // super_owner only
  SYSTEM_CONFIG: 'system:config',
  SUBSCRIPTION_PLANS_WRITE: 'subscription-plans:write',
  ENCRYPTION_TOOLS: 'encryption:tools',
  SITEADMIN_MANAGE: 'siteadmin:manage',
} as const;

export type SiteAdminPermission =
  (typeof SITE_ADMIN_PERM)[keyof typeof SITE_ADMIN_PERM];

const CONTENT_ADMIN: SiteAdminPermission[] = [
  SITE_ADMIN_PERM.MASTER_DATA_READ,
  SITE_ADMIN_PERM.MASTER_DATA_WRITE,
];

const OPERATIONS_ADMIN: SiteAdminPermission[] = [
  ...CONTENT_ADMIN,
  SITE_ADMIN_PERM.BUSINESS_CREATE,
  SITE_ADMIN_PERM.BUSINESS_READ,
  SITE_ADMIN_PERM.BUSINESS_SUSPEND,
  SITE_ADMIN_PERM.BUSINESS_REACTIVATE,
  SITE_ADMIN_PERM.AUDIT_LOGS_READ,
  SITE_ADMIN_PERM.REPORTS_OPERATIONAL,
];

const FULL_ADMIN: SiteAdminPermission[] = [
  ...OPERATIONS_ADMIN,
  SITE_ADMIN_PERM.REPORTS_FINANCE,
  SITE_ADMIN_PERM.PAYMENT_RULES_READ,
  SITE_ADMIN_PERM.PAYMENT_RULES_WRITE,
];

const SUPER_OWNER: SiteAdminPermission[] = [
  ...FULL_ADMIN,
  SITE_ADMIN_PERM.SYSTEM_CONFIG,
  SITE_ADMIN_PERM.SUBSCRIPTION_PLANS_WRITE,
  SITE_ADMIN_PERM.ENCRYPTION_TOOLS,
  SITE_ADMIN_PERM.SITEADMIN_MANAGE,
];

/** Which permissions each role has (cumulative). */
export const SITEADMIN_ROLE_PERMISSIONS: Record<
  SiteAdminRole,
  SiteAdminPermission[]
> = {
  [SiteAdminRole.CONTENT_ADMIN]: CONTENT_ADMIN,
  [SiteAdminRole.OPERATIONS_ADMIN]: OPERATIONS_ADMIN,
  [SiteAdminRole.FULL_ADMIN]: FULL_ADMIN,
  [SiteAdminRole.SUPER_OWNER]: SUPER_OWNER,
};

/**
 * Whether a role has a given permission.
 * @param role the siteadmin's role
 * @param permission the permission key to check
 */
export function siteAdminCan(
  role: SiteAdminRole,
  permission: SiteAdminPermission,
): boolean {
  return SITEADMIN_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
