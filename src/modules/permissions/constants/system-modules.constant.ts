/**
 * The master system-module catalogue — the single keyed source of truth for
 * modules across the app. It has two tiers:
 *
 *  - **Permission-bearing modules** (`hasPermissions !== false`): the 7
 *    operational modules + 2 admin consoles of User Management v2.0. Every module
 *    dropdown, filter, Branch→Module enablement (`branch_modules`), default-module
 *    choice (`UserBranchProfile.defaultModuleId`), and per-(user+branch)
 *    permission grant keys off these. The permission catalogue
 *    (module-permissions.constant.ts) is generated from `PERMISSION_MODULES`.
 *
 *  - **Enablement-only modules** (`hasPermissions: false`): branch-catalogue
 *    feature areas (Registration, Laboratory, …) that a branch can enable but
 *    that have no fine-grained permission keys yet. They participate in
 *    Branch→Module enablement and the `GET /modules` catalogue, but never mint
 *    permission keys or expand role baselines.
 *
 * `order` mirrors the spec's numbering.
 */
/**
 * Service-line grouping used by the branch-creation module picker: common
 * modules render as a flat block, diagnostic/radiology modules each in their own
 * accordion. Also the basis for the derived `isDiagnosticAllowed` /
 * `isRadiologyAllowed` branch capabilities (see branch-modules.constant.ts).
 * Modules with no group (e.g. legacy-only keys) are treated as ungrouped.
 */
export type ModuleGroup = 'common' | 'diagnostic' | 'radiology';

export interface SystemModule {
  key: string;
  label: string;
  order: number;
  /**
   * Whether this module has fine-grained permissions. Defaults to `true`
   * (permission-bearing). Set `false` for enablement-only modules so they never
   * leak permission keys into the catalogue or role baselines.
   */
  hasPermissions?: boolean;
  /**
   * Service-line group for the branch module picker. Omitted for modules that
   * only appear in legacy branch types and have no place in the new grouped UI.
   */
  group?: ModuleGroup;
}

/**
 * The modules in **canonical display order** — the single predefined order used
 * everywhere a module list is shown or assigned (navbar tabs, `/business-admin/users`
 * module assignment, branch module picker, per-branch enablement). The order is
 * deliberate, NOT alphabetical and NOT sorted dynamically: the first seven are the
 * primary navigable modules in the exact product-specified sequence, and the
 * remaining operational/placeholder modules follow. `order` mirrors the array
 * index (1-based) and is kept in lockstep; array position is authoritative.
 *
 * `registration`, `lab_operations` (Technician) and `radiology` back **built** FE
 * pages gated by module visibility (`GET /users/manage/me/permissions` →
 * `moduleAllowed`); because the FE only reveals a module when it is
 * permission-allowed, these MUST be permission-bearing. `patient_management` and
 * `pharmacy` are enablement-only placeholders (`hasPermissions: false`) and stay
 * out of the permission catalogue until a real page ships. `business_admin` /
 * `branch_admin` are the admin consoles whose permission set is the full API
 * resource catalogue (see module-permissions.constant.ts), not the CRUD verbs.
 */
export const SYSTEM_MODULES: SystemModule[] = [
  { key: 'registration', label: 'Registration', order: 1, group: 'common' },
  { key: 'accession', label: 'Accession', order: 2, group: 'diagnostic' },
  { key: 'lab_operations', label: 'Laboratory', order: 3, group: 'diagnostic' },
  { key: 'radiology', label: 'Radiology', order: 4, group: 'radiology' },
  { key: 'finance', label: 'Finance', order: 5, group: 'common' },
  { key: 'branch_admin', label: 'Branch Admin', order: 6, group: 'common' },
  { key: 'business_admin', label: 'Business Admin', order: 7, group: 'common' },
  // ── Remaining operational modules (built, permission-bearing) ──
  { key: 'inventory', label: 'Inventory', order: 8, group: 'common' },
  { key: 'sales', label: 'Sales', order: 9, group: 'common' },
  {
    key: 'phlebotomist',
    label: 'Phlebotomist',
    order: 10,
    group: 'diagnostic',
  },
  { key: 'assistant', label: 'Assistant', order: 11 },
  { key: 'operation', label: 'Operation', order: 12 },
  // ── Enablement-only placeholders (no permission keys yet) ──
  {
    key: 'patient_management',
    label: 'Patient Management',
    order: 13,
    hasPermissions: false,
  },
  { key: 'pharmacy', label: 'Pharmacy', order: 14, hasPermissions: false },
];

/** All valid module keys, in spec order. */
export const SYSTEM_MODULE_KEYS: string[] = SYSTEM_MODULES.map((m) => m.key);

/**
 * The permission-bearing subset of {@link SYSTEM_MODULES}. The permission
 * catalogue and role baselines are generated from this list only, so
 * enablement-only modules never mint permission keys.
 */
export const PERMISSION_MODULES: SystemModule[] = SYSTEM_MODULES.filter(
  (m) => m.hasPermissions !== false,
);

/** Whether a string is a known system-module key. */
export function isValidModuleKey(key: string): boolean {
  return SYSTEM_MODULE_KEYS.includes(key);
}

/** Look up a module's display label (falls back to the raw key). */
export function moduleLabel(key: string): string {
  return SYSTEM_MODULES.find((m) => m.key === key)?.label ?? key;
}

/** Look up a module's service-line group (undefined for ungrouped modules). */
export function moduleGroup(key: string): ModuleGroup | undefined {
  return SYSTEM_MODULES.find((m) => m.key === key)?.group;
}
