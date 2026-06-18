/**
 * The 12 master system modules (User Management v2.0). Every module dropdown,
 * filter, Branch→Module enablement (`branch_modules`), default-module choice
 * (`UserBranchProfile.defaultModuleId`), and per-(user+branch) permission grant
 * keys off this list. `order` mirrors the spec's numbering.
 */
export interface SystemModule {
  key: string;
  label: string;
  order: number;
}

export const SYSTEM_MODULES: SystemModule[] = [
  { key: 'registration', label: 'Registration', order: 1 },
  { key: 'accession', label: 'Accession', order: 2 },
  { key: 'lab_operations', label: 'Lab Operations', order: 3 },
  { key: 'inventory', label: 'Inventory', order: 4 },
  { key: 'sales', label: 'Sales', order: 5 },
  { key: 'admin', label: 'Admin', order: 6 },
  { key: 'radiology', label: 'Radiology', order: 7 },
  { key: 'pharmacy', label: 'Pharmacy', order: 8 },
  { key: 'opd', label: 'OPD', order: 9 },
  { key: 'ipd', label: 'IPD', order: 10 },
  { key: 'finance', label: 'Finance', order: 11 },
  { key: 'phlebotomist', label: 'Phlebotomist', order: 12 },
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
