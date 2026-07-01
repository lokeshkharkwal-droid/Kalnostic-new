/**
 * The 9 master system modules (User Management v2.0): 7 operational modules plus
 * 2 admin-console modules. Every module dropdown, filter, Branch→Module
 * enablement (`branch_modules`), default-module choice
 * (`UserBranchProfile.defaultModuleId`), and per-(user+branch) permission grant
 * keys off this list. `order` mirrors the spec's numbering.
 */
export interface SystemModule {
  key: string;
  label: string;
  order: number;
}

export const SYSTEM_MODULES: SystemModule[] = [
  // ── 7 operational modules (branch-toggleable) ──
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
];

/** All valid module keys, in spec order. */
export const SYSTEM_MODULE_KEYS: string[] = SYSTEM_MODULES.map((m) => m.key);

/** Whether a string is a known system-module key. */
export function isValidModuleKey(key: string): boolean {
  return SYSTEM_MODULE_KEYS.includes(key);
}

/** Look up a module's display label (falls back to the raw key). */
export function moduleLabel(key: string): string {
  return SYSTEM_MODULES.find((m) => m.key === key)?.label ?? key;
}
