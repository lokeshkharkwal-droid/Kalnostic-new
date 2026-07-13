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
}

export const SYSTEM_MODULES: SystemModule[] = [
  // ── 7 operational modules (branch-toggleable, permission-bearing) ──
  { key: 'accession', label: 'Accession', order: 1 },
  { key: 'inventory', label: 'Inventory', order: 2 },
  { key: 'sales', label: 'Sales', order: 3 },
  { key: 'finance', label: 'Finance', order: 4 },
  { key: 'phlebotomist', label: 'Phlebotomist', order: 5 },
  { key: 'assistant', label: 'Assistant', order: 6 },
  { key: 'operation', label: 'Operation', order: 7 },
  // ── Admin console modules (User Management v2.0) ──
  // Unlike the operational modules above, these are not branch-toggleable
  // feature areas — they are the admin "consoles" the Business Admin / Branch
  // Admin roles are linked to. Their permission set is the full API resource
  // catalogue (see module-permissions.constant.ts), not the standard CRUD verbs.
  { key: 'business_admin', label: 'Business Admin', order: 8 },
  { key: 'branch_admin', label: 'Branch Admin', order: 9 },
  // ── Branch-catalogue feature areas ──
  // Surfaced by the branch-type → module catalogue (branch-modules.constant.ts)
  // and enableable per branch. Keys are aligned to the frontend module routes
  // (e.g. `lab_operations` → /technician).
  //
  // `registration` and `lab_operations` back **built** FE pages that are gated by
  // module visibility (`GET /users/manage/me/permissions` → `moduleAllowed`).
  // Because the FE only reveals a module when it is permission-allowed, these two
  // MUST be permission-bearing — otherwise their tab/route can never appear for
  // any user. They therefore mint the four standard actions like any operational
  // module. The remaining three (`patient_management`/`radiology`/`pharmacy`) are
  // still enablement-only: their FE pages are placeholders (Coming Soon), so they
  // stay out of the permission catalogue until a real page ships.
  { key: 'registration', label: 'Registration', order: 10 },
  { key: 'lab_operations', label: 'Laboratory', order: 11 },
  {
    key: 'patient_management',
    label: 'Patient Management',
    order: 12,
    hasPermissions: false,
  },
  { key: 'radiology', label: 'Radiology', order: 13, hasPermissions: false },
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
