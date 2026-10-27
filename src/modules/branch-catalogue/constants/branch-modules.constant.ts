/**
 * Branch-type → module catalogue.
 *
 * This constant is the **single source of truth** for which modules a branch
 * type offers — the `GET /branch-types` and `GET /modules` endpoints derive
 * every response from it at request time (there is no database table).
 *
 * Values are **module keys** from the unified `SYSTEM_MODULES` catalogue
 * (permissions/constants/system-modules.constant.ts); the endpoints resolve each
 * key to its label (and `group`) via that catalogue when building the response.
 * Keys must exist in `SYSTEM_MODULE_KEYS`.
 *
 * ## Center-type model (current)
 *
 * The product now ships a single branch type ("Combined") with a **Center Type**
 * selector in the UI that maps onto three of these keys:
 *
 *  - **Main Center → `COMBINED`** — runs both service lines (diagnostic +
 *    radiology), so it offers the common modules plus both service-line groups.
 *  - **Collection Center → `COLLECTION_CENTER`** and **Franchise → `FRANCHISE`**
 *    — diagnostic only: common modules + the diagnostic group, **no radiology**.
 *
 * The remaining keys (`DIAGNOSTIC`, `RADIOLOGY`, `OPD`, `PHARMACY`, `BLOOD_BANK`)
 * are **legacy** — no longer offered in the new selector, but retained so
 * existing branches carrying those `branchType`s still resolve a module list on
 * edit. Do not remove them without a data migration.
 *
 * To add a branch type or a module, edit this object (and, for a brand-new
 * module, add it to `SYSTEM_MODULES`) — the API reflects the change with no
 * other code edits.
 */

/** Modules shared by every center type (the "Common" group in the UI). */
const COMMON_MODULES = [
  'registration',
  'finance',
  'inventory',
  'sales',
  'branch_admin',
  'business_admin',
] as const;

/** Diagnostic service-line modules (drive `isDiagnosticAllowed`). */
const DIAGNOSTIC_MODULES = [
  'accession',
  'lab_operations',
  'phlebotomist',
] as const;

/** Radiology service-line modules (drive `isRadiologyAllowed`). */
const RADIOLOGY_MODULES = ['radiology'] as const;

export const BRANCH_MODULES: Readonly<Record<string, readonly string[]>> = {
  // ── Current center types ──
  COMBINED: [...COMMON_MODULES, ...DIAGNOSTIC_MODULES, ...RADIOLOGY_MODULES],
  COLLECTION_CENTER: [...COMMON_MODULES, ...DIAGNOSTIC_MODULES],
  FRANCHISE: [...COMMON_MODULES, ...DIAGNOSTIC_MODULES],

  // ── Legacy branch types (retained for backward compat; not offered in the UI) ──
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
    'radiology',
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
  BLOOD_BANK: [],
};
