/**
 * The full catalogue of fine-grained permissions in the system, grouped for
 * display in the permission-override UI. `code` is the stable identifier used
 * in `PROFILE_PERMISSIONS` and in `user_profile_permission_overrides`.
 */
export interface PermissionCatalogEntry {
  code: string;
  name: string;
  group: string;
}

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  // Patients
  { code: 'patient:read', name: 'View patients', group: 'Patients' },
  { code: 'patient:create', name: 'Register patients', group: 'Patients' },
  { code: 'patient:update', name: 'Edit patients', group: 'Patients' },

  // Orders
  { code: 'order:read', name: 'View orders', group: 'Orders' },
  { code: 'order:create', name: 'Create orders', group: 'Orders' },
  { code: 'order:update', name: 'Edit orders', group: 'Orders' },

  // Reports
  { code: 'report:read', name: 'View reports', group: 'Reports' },
  { code: 'report:verify', name: 'Verify/sign reports', group: 'Reports' },

  // Staff
  { code: 'staff:read', name: 'View staff', group: 'Staff' },
  { code: 'staff:manage', name: 'Manage staff & profiles', group: 'Staff' },

  // Billing
  { code: 'billing:read', name: 'View billing', group: 'Billing' },
  { code: 'billing:manage', name: 'Manage billing', group: 'Billing' },
];
