import { IsUUID } from 'class-validator';

/**
 * Query for `GET /orders/patient-dues` — the patient whose outstanding previous
 * dues (summed across their active, non-cancelled orders at the active branch)
 * should be returned so the Create Order screen can display + pre-validate them.
 */
export class PatientDuesQueryDto {
  /** The patient to compute outstanding dues for. */
  @IsUUID()
  patientId: string;
}
