import {
  MedicalHistory,
  Patient,
  PatientFamilyLink,
  Relationship,
} from '@prisma/client';

/** Domain/response shape for a patient (the Prisma model is the DB source of truth). */
export type PatientEntity = Patient;

/** Domain/response shape for a medical-history record. */
export type MedicalHistoryEntity = MedicalHistory;

/** The mapped PT Category (id + name + owning branch) embedded on a patient. */
export interface PatientPtCategory {
  id: string;
  categoryName: string;
  branchId: string;
}

/**
 * A patient together with its active (non-deleted) medical-history records and
 * its (optional) mapped PT Category — the latter lets the Create Order / Create
 * Patient forms pre-select the category and check it belongs to the active branch.
 */
export type PatientWithHistory = Patient & {
  medicalHistories: MedicalHistory[];
  ptCategory?: PatientPtCategory | null;
};

/**
 * A family link flattened for API responses: the mapping row's id/relationship
 * plus a lightweight summary of the linked member patient. Used by
 * `GET /patients/:patientId/family-members` and the `includeFamily` list flag.
 */
export interface FamilyMemberSummary {
  linkId: string;
  relationship: Relationship;
  member: {
    id: string;
    firstName: string;
    lastName: string | null;
    age: number | null;
    mobile: string;
    umId: string | null;
  };
}

/** The created family link together with the newly created member patient. */
export interface FamilyMemberResult {
  link: PatientFamilyLink;
  member: Patient;
}

/** A patient list row optionally carrying its active family members. */
export type PatientWithFamily = Patient & {
  familyMembers?: FamilyMemberSummary[];
};

/**
 * The shared platform identity + owning business surfaced by
 * `GET /patients/cross-tenant-lookup` when a mobile number belongs to a patient
 * in another tenant. Full patient details are exposed by design so the operator
 * can confirm the match before reusing the identity.
 */
export interface CrossTenantPatientMatch {
  /** The shared platform-level identity (globally-unique phone). */
  person: {
    id: string;
    platformMrn: string;
    salutation: string | null;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
    gender: string | null;
    bloodGroup: string | null;
    dateOfBirth: Date | null;
    phone: string | null;
    email: string | null;
    address: unknown;
    aadhaarNumber: string | null;
    panNumber: string | null;
    emergencyContactName: string | null;
    emergencyContactNumber: string | null;
  };
  /** The business that first registered this person (owns their basic details). */
  ownerTenant: {
    id: string;
    name: string;
    shortName: string | null;
    email: string | null;
    phone: string | null;
    logoUrl: string | null;
  } | null;
  /**
   * True when the caller's tenant already has an active patient linked to this
   * identity — the operator should just select that existing patient instead of
   * importing (no confirmation/import needed).
   */
  existsInCurrentTenant: boolean;
}

/** Result of `GET /patients/cross-tenant-lookup`: a match, or `null` when none. */
export interface CrossTenantLookupResult {
  match: CrossTenantPatientMatch | null;
}
