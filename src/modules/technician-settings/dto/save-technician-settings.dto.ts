import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const SIGNATORY_BASES = [
  'department',
  'category',
  'subCategory',
] as const;

/**
 * Save/upsert payload for Technician Laboratory settings (Analytical TAT
 * thresholds + Laboratory Permissions). All fields optional so the frontend
 * can patch a single card or submit the whole form.
 */
export class SaveTechnicianSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  tatWarningMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  tatCriticalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  tatImminentMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isViewRerunIconEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isViewCriticalAlertIconEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isViewOutOfRangeIconEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isViewDeltaCheckIconEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isViewScheduledTestIconEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  authoritySignatures?: number;

  @IsOptional()
  @IsIn(SIGNATORY_BASES)
  signatoryBasis?: (typeof SIGNATORY_BASES)[number];
}
