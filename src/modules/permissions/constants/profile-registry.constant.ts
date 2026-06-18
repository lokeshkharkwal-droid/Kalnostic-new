import { BranchType } from '@prisma/client';

/**
 * The canonical list of business-user profile keys (roles).
 *
 * The first block is the original six keys (kept for backward compatibility with
 * existing assignments, the auth/JWT path, and the legacy permission-override
 * endpoints). The second block adds the User Management v2.0 predefined roles.
 *
 * `business_admin`, `administrator` and `patient` are tenant-level (no branch).
 * The rest are branch-level and must match a branch's `branchType` per
 * PROFILE_BRANCH_MATRIX.
 */
export const PROFILE_REGISTRY = [
  // ── Original (back-compat) ──
  'business_admin',
  'branch_admin',
  'doctor',
  'lab_technician',
  'receptionist',
  'patient',
  // ── User Management v2.0 predefined roles ──
  'administrator',
  'junior_lab_technician',
  'senior_lab_technician',
  'consultant_doctor',
  'reporting_doctor',
  'phlebotomist',
  'marketing_executive',
  'marketing_manager',
  'inventory_manager',
  'chemist',
  'chemist_assistant',
  'finance_manager',
  'finance_assistant',
  'logistics_executive',
  'opd_assistant',
  'radiology_assistant',
  'nursing_staff',
  'nursing_incharge',
] as const;

export type ProfileKey = (typeof PROFILE_REGISTRY)[number];

/**
 * Staff-assignable roles — every profile key except `patient`. Used by the
 * Create/Update User DTOs (`@IsIn`) to validate the chosen role.
 */
export const STAFF_ROLE_KEYS: ProfileKey[] = PROFILE_REGISTRY.filter(
  (k) => k !== 'patient',
);

/** Human-readable labels for the profile switcher / role dropdowns. */
export const PROFILE_LABELS: Record<ProfileKey, string> = {
  business_admin: 'Business Admin',
  branch_admin: 'Branch Admin',
  doctor: 'Doctor',
  lab_technician: 'Lab Technician',
  receptionist: 'Receptionist',
  patient: 'Patient',
  administrator: 'Administrator',
  junior_lab_technician: 'Junior Lab Technician',
  senior_lab_technician: 'Senior Lab Technician',
  consultant_doctor: 'Consultant Doctor',
  reporting_doctor: 'Reporting Doctor',
  phlebotomist: 'Phlebotomist',
  marketing_executive: 'Marketing Executive',
  marketing_manager: 'Marketing Manager',
  inventory_manager: 'Inventory Manager',
  chemist: 'Chemist',
  chemist_assistant: 'Chemist Assistant',
  finance_manager: 'Finance Manager',
  finance_assistant: 'Finance Assistant',
  logistics_executive: 'Logistics Executive',
  opd_assistant: 'OPD Assistant',
  radiology_assistant: 'Radiology Assistant',
  nursing_staff: 'Nursing Staff',
  nursing_incharge: 'Nursing Incharge',
};

/**
 * Which branch types each profile may be assigned at.
 * An **empty array** means the profile is **tenant-level** (branch_id = NULL),
 * e.g. `business_admin`, `administrator`, `patient`.
 */
export const PROFILE_BRANCH_MATRIX: Record<ProfileKey, BranchType[]> = {
  // Tenant-level
  business_admin: [],
  administrator: [],
  patient: [],
  // Branch-level (original)
  branch_admin: [
    BranchType.DIAGNOSTIC,
    BranchType.RADIOLOGY,
    BranchType.OPD,
    BranchType.IPD,
    BranchType.PHARMACY,
    BranchType.INVENTORY,
    BranchType.BLOOD_BANK,
    BranchType.FRANCHISE,
    BranchType.COMBINED,
  ],
  doctor: [BranchType.OPD, BranchType.IPD, BranchType.DIAGNOSTIC],
  lab_technician: [BranchType.DIAGNOSTIC, BranchType.IPD],
  receptionist: [
    BranchType.DIAGNOSTIC,
    BranchType.OPD,
    BranchType.IPD,
    BranchType.PHARMACY,
    BranchType.FRANCHISE,
  ],
  // Branch-level (v2.0)
  junior_lab_technician: [
    BranchType.DIAGNOSTIC,
    BranchType.IPD,
    BranchType.BLOOD_BANK,
    BranchType.TECHNICIAN,
    BranchType.COMBINED,
  ],
  senior_lab_technician: [
    BranchType.DIAGNOSTIC,
    BranchType.IPD,
    BranchType.BLOOD_BANK,
    BranchType.TECHNICIAN,
    BranchType.COMBINED,
  ],
  consultant_doctor: [
    BranchType.OPD,
    BranchType.IPD,
    BranchType.DIAGNOSTIC,
    BranchType.RADIOLOGY,
    BranchType.COMBINED,
  ],
  reporting_doctor: [
    BranchType.DIAGNOSTIC,
    BranchType.RADIOLOGY,
    BranchType.IPD,
    BranchType.COMBINED,
  ],
  phlebotomist: [
    BranchType.DIAGNOSTIC,
    BranchType.OPD,
    BranchType.IPD,
    BranchType.BLOOD_BANK,
    BranchType.COMBINED,
  ],
  marketing_executive: [
    BranchType.DIAGNOSTIC,
    BranchType.OPD,
    BranchType.FRANCHISE,
    BranchType.COMBINED,
  ],
  marketing_manager: [
    BranchType.DIAGNOSTIC,
    BranchType.OPD,
    BranchType.FRANCHISE,
    BranchType.COMBINED,
  ],
  inventory_manager: [
    BranchType.INVENTORY,
    BranchType.PHARMACY,
    BranchType.DIAGNOSTIC,
    BranchType.COMBINED,
  ],
  chemist: [BranchType.PHARMACY, BranchType.COMBINED],
  chemist_assistant: [BranchType.PHARMACY, BranchType.COMBINED],
  finance_manager: [
    BranchType.DIAGNOSTIC,
    BranchType.OPD,
    BranchType.IPD,
    BranchType.PHARMACY,
    BranchType.FRANCHISE,
    BranchType.COMBINED,
  ],
  finance_assistant: [
    BranchType.DIAGNOSTIC,
    BranchType.OPD,
    BranchType.IPD,
    BranchType.PHARMACY,
    BranchType.FRANCHISE,
    BranchType.COMBINED,
  ],
  logistics_executive: [
    BranchType.INVENTORY,
    BranchType.ACCESSION,
    BranchType.DIAGNOSTIC,
    BranchType.COMBINED,
  ],
  opd_assistant: [BranchType.OPD, BranchType.COMBINED],
  radiology_assistant: [BranchType.RADIOLOGY, BranchType.COMBINED],
  nursing_staff: [BranchType.OPD, BranchType.IPD, BranchType.COMBINED],
  nursing_incharge: [BranchType.OPD, BranchType.IPD, BranchType.COMBINED],
};

/**
 * Whether a string is a known profile key.
 * @param key candidate profile key
 */
export function isValidProfileKey(key: string): key is ProfileKey {
  return (PROFILE_REGISTRY as readonly string[]).includes(key);
}

/**
 * Whether a profile may be assigned at a branch of the given type.
 * @param profileKey the profile being assigned
 * @param branchType the branch's type
 */
export function isProfileValidForBranch(
  profileKey: ProfileKey,
  branchType: BranchType,
): boolean {
  return (PROFILE_BRANCH_MATRIX[profileKey] ?? []).includes(branchType);
}
