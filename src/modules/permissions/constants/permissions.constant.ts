import { ProfileKey } from './profile-registry.constant';

/** A permission code from the catalogue (see permission-catalog.constant.ts). */
export type Permission = string;

/**
 * Baseline permissions granted by each profile, before per-assignment
 * overrides. The effective set = baseline ± overrides (allow/deny), resolved in
 * `UsersService.getProfilePermissions`.
 */
export const PROFILE_PERMISSIONS: Record<ProfileKey, Permission[]> = {
  business_admin: [
    'patient:read',
    'patient:create',
    'patient:update',
    'order:read',
    'order:create',
    'order:update',
    'report:read',
    'report:verify',
    'staff:read',
    'staff:manage',
    'billing:read',
    'billing:manage',
  ],
  branch_admin: [
    'patient:read',
    'patient:create',
    'patient:update',
    'order:read',
    'order:create',
    'order:update',
    'report:read',
    'staff:read',
    'staff:manage',
    'billing:read',
  ],
  doctor: [
    'patient:read',
    'order:read',
    'order:create',
    'report:read',
    'report:verify',
  ],
  lab_technician: ['order:read', 'order:update', 'report:read'],
  receptionist: [
    'patient:read',
    'patient:create',
    'order:read',
    'order:create',
    'billing:read',
  ],
  patient: ['report:read'],
};
