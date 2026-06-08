import { BranchType } from '@prisma/client';

/**
 * The canonical list of business-user profile keys (roles).
 *
 * `business_admin` and `patient` are tenant-level (no branch). The rest are
 * branch-level and must match a branch's `branchType` per PROFILE_BRANCH_MATRIX.
 */
export const PROFILE_REGISTRY = [
  'business_admin',
  'branch_admin',
  'doctor',
  'lab_technician',
  'receptionist',
  'patient',
] as const;

export type ProfileKey = (typeof PROFILE_REGISTRY)[number];

/** Human-readable labels for the profile switcher UI. */
export const PROFILE_LABELS: Record<ProfileKey, string> = {
  business_admin: 'Business Admin',
  branch_admin: 'Branch Admin',
  doctor: 'Doctor',
  lab_technician: 'Lab Technician',
  receptionist: 'Receptionist',
  patient: 'Patient',
};

/**
 * Which branch types each profile may be assigned at.
 * An **empty array** means the profile is **tenant-level** (branch_id = NULL),
 * e.g. `business_admin`.
 */
export const PROFILE_BRANCH_MATRIX: Record<ProfileKey, BranchType[]> = {
  business_admin: [],
  patient: [],
  branch_admin: [
    BranchType.DIAGNOSTIC,
    BranchType.OPD,
    BranchType.IPD,
    BranchType.PHARMACY,
    BranchType.FRANCHISE,
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
