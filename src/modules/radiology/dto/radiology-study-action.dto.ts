import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Shared payload for a radiology-study status action (schedule / acquire /
 * validate / approve / publish / hold / cancel / retrieve). All fields optional —
 * captured on the status-history row.
 */
export class RadiologyStudyActionDto {
  /** Reason for the action (e.g. a hold/cancel reason). */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  /** Free-text note recorded on the history row. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** URL of a supporting attachment (no upload endpoint — URL only). */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  attachmentUrl?: string;
}
