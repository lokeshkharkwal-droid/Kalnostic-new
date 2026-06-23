import { ProfileKey } from './profile-registry.constant';
import { SYSTEM_MODULES } from './system-modules.constant';

/**
 * Module-grouped, fine-grained permission catalogue (User Management v2.0).
 *
 * Each entry belongs to exactly one system module (see system-modules.constant)
 * and is identified by a stable `permissionKey` used in the
 * `user_branch_permissions` table. This is the v2.0 counterpart to the legacy
 * flat PERMISSION_CATALOG; the two coexist during the transition.
 */
export interface ModulePermissionEntry {
  moduleKey: string;
  permissionKey: string;
  label: string;
}

/**
 * The four canonical actions every module exposes. `write` is the create
 * capability (named `write` for a uniform view/write/edit/delete contract that
 * the frontend keys off for show/hide).
 */
const STANDARD_ACTIONS: { action: string; verb: string }[] = [
  { action: 'view', verb: 'View' },
  { action: 'write', verb: 'Create in' },
  { action: 'edit', verb: 'Edit' },
  { action: 'delete', verb: 'Delete from' },
];

/**
 * Domain-specific permissions beyond the four standard actions, per module.
 * These carry meaning the CRUD verbs can't (verify, dispense, admit, …) and are
 * appended after the standard set in catalogue order.
 */
const EXTRA_PERMISSIONS: Record<string, { action: string; label: string }[]> = {
  lab_operations: [
    { action: 'enter_results', label: 'Enter results' },
    { action: 'verify', label: 'Verify/sign results' },
  ],
  admin: [
    { action: 'manage_users', label: 'Manage users' },
    { action: 'manage_branches', label: 'Manage branches' },
    { action: 'manage_permissions', label: 'Manage permissions' },
  ],
  radiology: [
    { action: 'report', label: 'Report radiology study' },
    { action: 'verify', label: 'Verify radiology report' },
  ],
  pharmacy: [
    { action: 'dispense', label: 'Dispense medication' },
    { action: 'manage_stock', label: 'Manage pharmacy stock' },
  ],
  ipd: [
    { action: 'admit', label: 'Admit patient' },
    { action: 'discharge', label: 'Discharge patient' },
  ],
  finance: [
    { action: 'manage', label: 'Manage finance' },
    { action: 'reports', label: 'View finance reports' },
  ],
  phlebotomist: [{ action: 'collect_sample', label: 'Collect sample' }],
};

/**
 * Module-grouped permission catalogue: for each of the 12 system modules, the
 * four standard actions (`view`/`write`/`edit`/`delete`) followed by any
 * domain-specific extras. Permission keys are `module:action`.
 */
export const MODULE_PERMISSION_CATALOG: ModulePermissionEntry[] =
  SYSTEM_MODULES.flatMap((m) => [
    ...STANDARD_ACTIONS.map((a) => ({
      moduleKey: m.key,
      permissionKey: `${m.key}:${a.action}`,
      label: `${a.verb} ${m.label}`,
    })),
    ...(EXTRA_PERMISSIONS[m.key] ?? []).map((extra) => ({
      moduleKey: m.key,
      permissionKey: `${m.key}:${extra.action}`,
      label: extra.label,
    })),
  ]);

/** One action within a module group of the system permission catalogue. */
export interface PermissionCatalogAction {
  permissionKey: string;
  action: string; // the part after the colon, e.g. 'view'
  label: string;
}

/** A module with all its permission actions (system catalogue, no user context). */
export interface PermissionCatalogModule {
  moduleKey: string;
  moduleLabel: string;
  permissions: PermissionCatalogAction[];
}

/**
 * The full system permission catalogue, grouped by module (catalogue order).
 * Pure static data derived from `MODULE_PERMISSION_CATALOG` — used by admin
 * permission editors to render the complete grid before toggling a user's
 * overrides.
 */
export const PERMISSION_CATALOG_BY_MODULE: PermissionCatalogModule[] =
  SYSTEM_MODULES.map((m) => ({
    moduleKey: m.key,
    moduleLabel: m.label,
    permissions: MODULE_PERMISSION_CATALOG.filter(
      (e) => e.moduleKey === m.key,
    ).map((e) => ({
      permissionKey: e.permissionKey,
      action: e.permissionKey.slice(e.permissionKey.indexOf(':') + 1),
      label: e.label,
    })),
  }));

/** Permission keys belonging to a module, in catalogue order. */
export function modulePermissionKeys(moduleKey: string): string[] {
  return MODULE_PERMISSION_CATALOG.filter((e) => e.moduleKey === moduleKey).map(
    (e) => e.permissionKey,
  );
}

/**
 * Default modules each role is granted at baseline. A role's baseline permission
 * set is every permission key of these modules; per-(user+branch) rows in
 * `user_branch_permissions` then override individual keys. Baselines remain
 * fully editable (per the spec) — this only seeds the initial grant.
 */
export const ROLE_DEFAULT_MODULES: Record<ProfileKey, string[]> = {
  business_admin: SYSTEM_MODULES_ALL(),
  administrator: SYSTEM_MODULES_ALL(),
  branch_admin: SYSTEM_MODULES_ALL(),
  patient: [],
  doctor: ['registration', 'lab_operations', 'opd', 'radiology'],
  consultant_doctor: ['opd', 'ipd', 'lab_operations', 'radiology'],
  reporting_doctor: ['lab_operations', 'radiology'],
  lab_technician: ['accession', 'lab_operations'],
  junior_lab_technician: ['accession', 'lab_operations'],
  senior_lab_technician: ['accession', 'lab_operations'],
  receptionist: ['registration', 'sales', 'opd'],
  phlebotomist: ['phlebotomist', 'accession'],
  marketing_executive: ['sales'],
  marketing_manager: ['sales', 'finance'],
  inventory_manager: ['inventory'],
  chemist: ['pharmacy'],
  chemist_assistant: ['pharmacy'],
  finance_manager: ['finance', 'sales'],
  finance_assistant: ['finance'],
  logistics_executive: ['inventory', 'accession'],
  opd_assistant: ['opd', 'registration'],
  radiology_assistant: ['radiology'],
  nursing_staff: ['opd', 'ipd'],
  nursing_incharge: ['opd', 'ipd'],
};

/** Expand a list of module keys into all their permission keys (catalogue order). */
function expandModulePermissions(moduleKeys: string[]): string[] {
  const keys: string[] = [];
  for (const moduleKey of moduleKeys) {
    for (const k of modulePermissionKeys(moduleKey)) {
      keys.push(k);
    }
  }
  return keys;
}

/**
 * A predefined role template: two **independent** lists — the permissions it grants
 * and the modules it is linked to. `modules` may be empty (a template not linked to
 * any module). Each template is seeded so its permissions are the expansion of its
 * linked modules, but the two lists are independent and may be edited separately.
 */
export interface RoleTemplate {
  permissions: string[];
  modules: string[];
}

/** The predefined role templates, keyed by role (profile) key. */
export const ROLE_TEMPLATES: Record<ProfileKey, RoleTemplate> =
  Object.fromEntries(
    (Object.keys(ROLE_DEFAULT_MODULES) as ProfileKey[]).map((role) => {
      const modules = ROLE_DEFAULT_MODULES[role] ?? [];
      return [role, { modules, permissions: expandModulePermissions(modules) }];
    }),
  ) as Record<ProfileKey, RoleTemplate>;

/** The baseline permission keys granted to a role (its template's permission list). */
export function roleBaselinePermissions(roleKey: string): Set<string> {
  return new Set(ROLE_TEMPLATES[roleKey as ProfileKey]?.permissions ?? []);
}

/** The modules linked to a role template (may be empty = not linked to a module). */
export function roleTemplateModules(roleKey: string): string[] {
  return ROLE_TEMPLATES[roleKey as ProfileKey]?.modules ?? [];
}

/** All 12 module keys (helper to avoid importing the array eagerly above). */
function SYSTEM_MODULES_ALL(): string[] {
  return [
    'registration',
    'accession',
    'lab_operations',
    'inventory',
    'sales',
    'admin',
    'radiology',
    'pharmacy',
    'opd',
    'ipd',
    'finance',
    'phlebotomist',
  ];
}
