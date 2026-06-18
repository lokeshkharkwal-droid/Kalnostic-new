import { ProfileKey } from './profile-registry.constant';

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

export const MODULE_PERMISSION_CATALOG: ModulePermissionEntry[] = [
  // Registration
  {
    moduleKey: 'registration',
    permissionKey: 'registration:view',
    label: 'View registrations',
  },
  {
    moduleKey: 'registration',
    permissionKey: 'registration:create',
    label: 'Create registration',
  },
  {
    moduleKey: 'registration',
    permissionKey: 'registration:edit',
    label: 'Edit registration',
  },
  {
    moduleKey: 'registration',
    permissionKey: 'registration:delete',
    label: 'Delete registration',
  },

  // Accession
  {
    moduleKey: 'accession',
    permissionKey: 'accession:view',
    label: 'View accessions',
  },
  {
    moduleKey: 'accession',
    permissionKey: 'accession:create',
    label: 'Create accession',
  },
  {
    moduleKey: 'accession',
    permissionKey: 'accession:edit',
    label: 'Edit accession',
  },

  // Lab Operations
  {
    moduleKey: 'lab_operations',
    permissionKey: 'lab_operations:view',
    label: 'View lab operations',
  },
  {
    moduleKey: 'lab_operations',
    permissionKey: 'lab_operations:enter_results',
    label: 'Enter results',
  },
  {
    moduleKey: 'lab_operations',
    permissionKey: 'lab_operations:verify',
    label: 'Verify/sign results',
  },
  {
    moduleKey: 'lab_operations',
    permissionKey: 'lab_operations:edit',
    label: 'Edit lab operations',
  },

  // Inventory
  {
    moduleKey: 'inventory',
    permissionKey: 'inventory:view',
    label: 'View inventory',
  },
  {
    moduleKey: 'inventory',
    permissionKey: 'inventory:create',
    label: 'Add inventory item',
  },
  {
    moduleKey: 'inventory',
    permissionKey: 'inventory:edit',
    label: 'Edit inventory item',
  },
  {
    moduleKey: 'inventory',
    permissionKey: 'inventory:delete',
    label: 'Delete inventory item',
  },

  // Sales
  { moduleKey: 'sales', permissionKey: 'sales:view', label: 'View sales' },
  { moduleKey: 'sales', permissionKey: 'sales:create', label: 'Create sale' },
  { moduleKey: 'sales', permissionKey: 'sales:edit', label: 'Edit sale' },

  // Admin
  { moduleKey: 'admin', permissionKey: 'admin:view', label: 'View admin area' },
  {
    moduleKey: 'admin',
    permissionKey: 'admin:manage_users',
    label: 'Manage users',
  },
  {
    moduleKey: 'admin',
    permissionKey: 'admin:manage_branches',
    label: 'Manage branches',
  },
  {
    moduleKey: 'admin',
    permissionKey: 'admin:manage_permissions',
    label: 'Manage permissions',
  },

  // Radiology
  {
    moduleKey: 'radiology',
    permissionKey: 'radiology:view',
    label: 'View radiology',
  },
  {
    moduleKey: 'radiology',
    permissionKey: 'radiology:report',
    label: 'Report radiology study',
  },
  {
    moduleKey: 'radiology',
    permissionKey: 'radiology:verify',
    label: 'Verify radiology report',
  },

  // Pharmacy
  {
    moduleKey: 'pharmacy',
    permissionKey: 'pharmacy:view',
    label: 'View pharmacy',
  },
  {
    moduleKey: 'pharmacy',
    permissionKey: 'pharmacy:dispense',
    label: 'Dispense medication',
  },
  {
    moduleKey: 'pharmacy',
    permissionKey: 'pharmacy:manage_stock',
    label: 'Manage pharmacy stock',
  },

  // OPD
  { moduleKey: 'opd', permissionKey: 'opd:view', label: 'View OPD' },
  { moduleKey: 'opd', permissionKey: 'opd:create', label: 'Create OPD visit' },
  { moduleKey: 'opd', permissionKey: 'opd:edit', label: 'Edit OPD visit' },

  // IPD
  { moduleKey: 'ipd', permissionKey: 'ipd:view', label: 'View IPD' },
  { moduleKey: 'ipd', permissionKey: 'ipd:admit', label: 'Admit patient' },
  {
    moduleKey: 'ipd',
    permissionKey: 'ipd:discharge',
    label: 'Discharge patient',
  },
  { moduleKey: 'ipd', permissionKey: 'ipd:edit', label: 'Edit IPD record' },

  // Finance
  {
    moduleKey: 'finance',
    permissionKey: 'finance:view',
    label: 'View finance',
  },
  {
    moduleKey: 'finance',
    permissionKey: 'finance:manage',
    label: 'Manage finance',
  },
  {
    moduleKey: 'finance',
    permissionKey: 'finance:reports',
    label: 'View finance reports',
  },

  // Phlebotomist
  {
    moduleKey: 'phlebotomist',
    permissionKey: 'phlebotomist:view',
    label: 'View phlebotomy queue',
  },
  {
    moduleKey: 'phlebotomist',
    permissionKey: 'phlebotomist:collect_sample',
    label: 'Collect sample',
  },
];

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
