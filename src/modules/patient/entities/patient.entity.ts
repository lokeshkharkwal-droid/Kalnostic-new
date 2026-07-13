import { MedicalHistory, Patient } from '@prisma/client';

/** Domain/response shape for a patient (the Prisma model is the DB source of truth). */
export type PatientEntity = Patient;

/** Domain/response shape for a medical-history record. */
export type MedicalHistoryEntity = MedicalHistory;

/** A patient together with its active (non-deleted) medical-history records. */
export type PatientWithHistory = Patient & {
  medicalHistories: MedicalHistory[];
};
