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
  finance: [
    { action: 'manage', label: 'Manage finance' },
    { action: 'reports', label: 'View finance reports' },
  ],
  phlebotomist: [{ action: 'collect_sample', label: 'Collect sample' }],
};

/**
 * The admin "console" modules. Their permission set is NOT the four CRUD verbs
 * but the full API resource catalogue below — they represent the Business Admin
 * and Branch Admin consoles, each exposing every management capability of the
 * (non-SiteAdmin) API surface. The Business Admin / Branch Admin roles are
 * linked 1:1 to these modules (see ROLE_DEFAULT_MODULES).
 */
export const ADMIN_CONSOLE_MODULE_KEYS = ['business_admin', 'branch_admin'];

/**
 * An API resource domain (from the Bruno collection, excluding SiteAdmin /
 * Business-Auth / Tenants) and the actions it exposes. Permission keys are
 * `${domain}:${action}`. Every domain emits the four standard CRUD actions
 * unless `standard: false`; `extra` carries the non-CRUD capabilities a domain
 * offers (clone, bulk-import, manage_modules, …).
 */
interface ResourceDomainDef {
  domain: string;
  label: string;
  /** Emit view/create/edit/delete. Defaults to true. */
  standard?: boolean;
  extra?: { action: string; label: string }[];
}

/** The four standard CRUD actions for a resource domain (uses `create`, not `write`). */
const RESOURCE_STANDARD_ACTIONS: { action: string; verb: string }[] = [
  { action: 'view', verb: 'View' },
  { action: 'create', verb: 'Create' },
  { action: 'edit', verb: 'Edit' },
  { action: 'delete', verb: 'Delete' },
];

/**
 * The API resource domains and their actions, derived 1:1 from the Bruno API
 * collection. This is the complete permission set of both admin consoles.
 */
const RESOURCE_DOMAINS: ResourceDomainDef[] = [
  {
    domain: 'branches',
    label: 'Branches',
    extra: [
      { action: 'manage_modules', label: 'Manage branch modules' },
      {
        action: 'manage_collection_mappings',
        label: 'Manage branch collection mappings',
      },
      { action: 'manage_main_branch', label: 'Manage main branch' },
    ],
  },
  {
    domain: 'users',
    label: 'Users',
    extra: [
      { action: 'assign_branches', label: 'Assign user to branches' },
      { action: 'manage_permissions', label: 'Manage user permissions' },
      { action: 'activate', label: 'Activate user' },
      { action: 'deactivate', label: 'Deactivate user' },
      { action: 'upload_photo', label: 'Upload user photo' },
    ],
  },
  { domain: 'schedules', label: 'Schedules' },
  // Audit API is read-only.
  {
    domain: 'audits',
    label: 'Audits',
    standard: false,
    extra: [{ action: 'view', label: 'View audit logs' }],
  },
  { domain: 'departments', label: 'Departments' },
  { domain: 'categories', label: 'Categories' },
  { domain: 'sub_categories', label: 'Sub-Categories' },
  { domain: 'master_data', label: 'Master Data' },
  {
    domain: 'lab_tests',
    label: 'Lab Tests',
    extra: [
      { action: 'clone', label: 'Clone lab tests' },
      { action: 'bulk_import', label: 'Bulk import lab tests' },
      { action: 'bulk_edit', label: 'Bulk edit lab tests' },
      { action: 'add_version', label: 'Add lab test version' },
    ],
  },
  {
    domain: 'lab_panels',
    label: 'Lab Panels',
    extra: [{ action: 'bulk_edit', label: 'Bulk edit lab panels' }],
  },
  { domain: 'outsource_centers', label: 'Outsource Centers' },
  { domain: 'doctors', label: 'Doctors' },
  { domain: 'referral_panels', label: 'Referral Panels' },
  { domain: 'referral_doctors', label: 'Referral Doctors' },
  { domain: 'internal_referrals', label: 'Internal Referrals' },
  { domain: 'external_referrals', label: 'External Referrals' },
  { domain: 'referral_panel_settings', label: 'Referral Panel Settings' },
  {
    domain: 'machines',
    label: 'Machines',
    extra: [
      { action: 'view_adapter_logs', label: 'View adapter logs' },
      { action: 'record_adapter_log', label: 'Record adapter log' },
      { action: 'mark_adapter_log_viewed', label: 'Mark adapter log viewed' },
    ],
  },
];

/**
 * The flat resource-permission set (`${domain}:${action}` + label) shared by
 * both admin consoles. Standard CRUD actions first, then each domain's extras.
 */
const RESOURCE_PERMISSION_DEFS: { permissionKey: string; label: string }[] =
  RESOURCE_DOMAINS.flatMap((d) => [
    ...((d.standard ?? true)
      ? RESOURCE_STANDARD_ACTIONS.map((a) => ({
          permissionKey: `${d.domain}:${a.action}`,
          label: `${a.verb} ${d.label}`,
        }))
      : []),
    ...(d.extra ?? []).map((e) => ({
      permissionKey: `${d.domain}:${e.action}`,
      label: e.label,
    })),
  ]);

/**
 * Module-grouped permission catalogue. The 14 operational modules emit the four
 * standard actions (`view`/`write`/`edit`/`delete`) plus any domain-specific
 * extras (keys `module:action`). The two admin-console modules
 * (`business_admin`, `branch_admin`) instead emit the full API resource
 * catalogue (keys `resource:action`) — so each console exposes every management
 * capability. Permission keys are therefore identical across the two consoles.
 */
export const MODULE_PERMISSION_CATALOG: ModulePermissionEntry[] =
  SYSTEM_MODULES.flatMap((m) =>
    ADMIN_CONSOLE_MODULE_KEYS.includes(m.key)
      ? RESOURCE_PERMISSION_DEFS.map((p) => ({
          moduleKey: m.key,
          permissionKey: p.permissionKey,
          label: p.label,
        }))
      : [
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
        ],
  );

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
  // The two admin roles map 1:1 to their console module, whose permission set is
  // the full API resource catalogue (see ADMIN_CONSOLE_MODULE_KEYS) — so both
  // roles' baselines expand to every API resource permission.
  business_admin: ['business_admin'],
  branch_admin: ['branch_admin'],
  administrator: SYSTEM_MODULES_ALL(),
  patient: [],
  doctor: [],
  consultant_doctor: [],
  reporting_doctor: [],
  lab_technician: ['accession'],
  junior_lab_technician: ['accession'],
  senior_lab_technician: ['accession'],
  receptionist: ['sales'],
  phlebotomist: ['phlebotomist', 'accession'],
  marketing_executive: ['sales'],
  marketing_manager: ['sales', 'finance'],
  inventory_manager: ['inventory'],
  chemist: [],
  chemist_assistant: [],
  finance_manager: ['finance', 'sales'],
  finance_assistant: ['finance'],
  logistics_executive: ['inventory', 'accession'],
  opd_assistant: [],
  radiology_assistant: [],
  nursing_staff: [],
  nursing_incharge: [],
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

/** All 7 operational module keys (helper to avoid importing the array eagerly above). */
function SYSTEM_MODULES_ALL(): string[] {
  return [
    'accession',
    'inventory',
    'sales',
    'finance',
    'phlebotomist',
    'assistant',
    'operation',
  ];
}
