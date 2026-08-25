import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Add a manual TAT adjustment record ("Adjust TAT History" — Turnaround Time
 * Details modal). `reason` is a free string, soft-validated on the frontend
 * against the branch's configurable `TechnicianSetting.tatAdjustmentReasons`
 * list (not a hard enum) — same convention as accession's repeat/error
 * reason dropdowns.
 */
export class CreateTatAdjustmentDto {
  @IsString()
  @MaxLength(255)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
