/**
 * Branch-type → module catalogue.
 *
 * This constant is the **single source of truth** for which modules a branch
 * type offers — the `GET /branch-types` and `GET /modules` endpoints derive
 * every response from it at request time (there is no database table).
 *
 * Values are **module keys** from the unified `SYSTEM_MODULES` catalogue
 * (permissions/constants/system-modules.constant.ts); the endpoints resolve each
 * key to its label via `moduleLabel` when building the `{ key, label }[]`
 * response. Keys must exist in `SYSTEM_MODULE_KEYS`.
 *
 * To add a branch type or a module, edit this object (and, for a brand-new
 * module, add it to `SYSTEM_MODULES`) — the API reflects the change with no
 * other code edits.
 */
export const BRANCH_MODULES: Readonly<Record<string, readonly string[]>> = {
  DIAGNOSTIC: [
    'registration',
    'accession',
    'lab_operations',
    'finance',
    'phlebotomist',
    'inventory',
    'sales',
    'branch_admin',
    'business_admin',
  ],
  OPD: [
    'registration',
    'patient_management',
    'phlebotomist',
    'finance',
    'sales',
    'inventory',
    'pharmacy',
    'branch_admin',
    'business_admin',
  ],
  RADIOLOGY: [
    'registration',
    'patient_management',
    'finance',
    'inventory',
    'sales',
    'branch_admin',
    'business_admin',
  ],
  PHARMACY: [
    'registration',
    'pharmacy',
    'finance',
    'inventory',
    'sales',
    'branch_admin',
    'business_admin',
  ],
  COMBINED: [
    'registration',
    'patient_management',
    'accession',
    'lab_operations',
    'radiology',
    'phlebotomist',
    'finance',
    'inventory',
    'sales',
    'pharmacy',
    'branch_admin',
    'business_admin',
  ],
  COLLECTION_CENTER: [],
  BLOOD_BANK: [],
};
