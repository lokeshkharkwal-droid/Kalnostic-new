import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** TAT thresholds (minutes) for the §A.4 Warning/Critical/Breached bands. */
export class TatThresholdsDto {
  @IsInt()
  @Min(0)
  warningMinutes: number;

  @IsInt()
  @Min(0)
  criticalMinutes: number;

  @IsInt()
  @Min(0)
  breachedMinutes: number;
}

/**
 * Save per-branch accession settings (PDF §G — configurable dropdowns +
 * thresholds). Every field is optional (a partial patch); omitted lists fall back
 * to `DEFAULT_ACCESSION_SETTINGS` at read time. Validated by `class-validator`
 * only; persisted as the branch's `AccessionSetting.config` JSON.
 */
export class SaveAccessionSettingsDto {
  /** Collection tube / sample types (Collect modal). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tubeTypes?: string[];

  /** Sample-condition options (Accept / Receive modals). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sampleConditions?: string[];

  /** Repeat reasons (Repeat modal). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  repeatReasons?: string[];

  /** Discard methods (Discard modal). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  discardMethods?: string[];

  /** Rejection reasons (transfer Reject modal). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rejectionReasons?: string[];

  /** Logistics types (Send / Forward / Outsource modals). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  logisticsTypes?: string[];

  /** TAT thresholds (minutes). */
  @IsOptional()
  @ValidateNested()
  @Type(() => TatThresholdsDto)
  tat?: TatThresholdsDto;
}
