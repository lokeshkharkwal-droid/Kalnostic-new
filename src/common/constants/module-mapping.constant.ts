import { BranchType } from '@prisma/client';

/**
 * The branch/module types that may be selected in a Department / Category /
 * Sub-Category **Module Mapping**.
 *
 * This is a curated SUBSET of the full `BranchType` enum. `BranchType` still
 * carries the complete set of values because it also drives branch creation and
 * the staff-role `PROFILE_BRANCH_MATRIX` — those are unaffected. Module mapping,
 * however, only supports these seven modules; the remaining values
 * (`FRANCHISE`, `COMBINED`, `ASSISTANT`, `ACCESSION`, `TECHNICIAN`,
 * `COLLECTION_CENTER`) are intentionally excluded and are rejected by the
 * validation pipe (`@IsIn`) so they can no longer be selected, created, or
 * assigned via the module-mapping DTOs.
 *
 * Single source of truth — used by every Department/Category/Sub-Category DTO
 * (create/update/template + the list filter). Keep in sync with the frontend
 * `MODULE_MAPPING_OPTIONS` (kaltros-fe `DeptCatSub/interface`).
 */
export const MODULE_MAPPING_BRANCH_TYPES: BranchType[] = [
  BranchType.DIAGNOSTIC,
  BranchType.OPD,
  BranchType.IPD,
  BranchType.RADIOLOGY,
  BranchType.INVENTORY,
  BranchType.PHARMACY,
  BranchType.BLOOD_BANK,
];
