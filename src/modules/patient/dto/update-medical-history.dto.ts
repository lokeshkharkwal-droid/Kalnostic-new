import { MedicalHistoryDto } from './medical-history.dto';

/**
 * Body for `PATCH /patients/:patientId/medical-history/:id`. Every field is
 * already optional on `MedicalHistoryDto`, so an update simply reuses that
 * shape (we deliberately do NOT use `PartialType` — SKILL.md §4). Only the
 * provided fields are applied.
 */
export class UpdateMedicalHistoryDto extends MedicalHistoryDto {}
