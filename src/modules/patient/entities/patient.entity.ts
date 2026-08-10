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
