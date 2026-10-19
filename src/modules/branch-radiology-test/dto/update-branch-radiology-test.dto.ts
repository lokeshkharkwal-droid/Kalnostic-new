import { DayOfWeek, SamplePriority, TatUnit } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { NoteMaxLength } from '../../../common/validators/note-max-length.validator';

/** 24h `HH:mm` time-of-day (00:00–23:59). */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Edit a branch radiology test's branch-tunable fields. Identity
 * (`testName`/`testCode`) is fixed at import (it is the branch-unique key and the
 * copy's link to its source); classification is managed via re-import/sync.
 * Prices are integer minor units; cross-field price ordering is enforced by the
 * CHECK constraints in prisma/rls.sql.
 */
export class UpdateBranchRadiologyTestDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  testDisplayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  aka?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  bodyPart?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  view?: string;

  @IsOptional()
  @IsBoolean()
  isContrast?: boolean;

  @IsOptional()
  @IsEnum(SamplePriority)
  samplePriorityType?: SamplePriority;

  @IsOptional()
  @IsBoolean()
  isEnableCms?: boolean;

  // Pricing
  /** The effective selling price for this list (minor units). */
  @IsOptional()
  @IsInt()
  @Min(0)
  listPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceMsrp?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceMaximum?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceMinimum?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceOriginal?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  franchisePrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  emergencyPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  commissionPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountCapPct?: number;

  @IsOptional()
  @IsBoolean()
  isAllowPriceOverride?: boolean;

  @IsOptional()
  @IsBoolean()
  isAllowDiscounts?: boolean;

  // TAT
  @IsOptional()
  @IsInt()
  @Min(0)
  tatMinValue?: number;

  @IsOptional()
  @IsEnum(TatUnit)
  tatMinUnit?: TatUnit;

  @IsOptional()
  @IsInt()
  @Min(0)
  tatMaxValue?: number;

  @IsOptional()
  @IsEnum(TatUnit)
  tatMaxUnit?: TatUnit;

  // Schedule — days the test runs + the daily session window.
  @IsOptional()
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  @ArrayUnique()
  scheduleDays?: DayOfWeek[];

  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'scheduleFrom must be a 24h HH:mm time' })
  scheduleFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'scheduleTo must be a 24h HH:mm time' })
  scheduleTo?: string;

  // Flags
  @IsOptional()
  @IsBoolean()
  isHideInOrderScreen?: boolean;

  @IsOptional()
  @IsBoolean()
  isPreferenceTest?: boolean;

  /** Billed but never enters the imaging workflow. */
  @IsOptional()
  @IsBoolean()
  isBillOnlyTest?: boolean;

  // Notes
  @IsOptional()
  @IsString()
  @NoteMaxLength('Useful For')
  usefulFor?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Interpretation')
  interpretationOfResults?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Limitations')
  limitations?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Remarks')
  remarks?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('References')
  references?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Preparation Instructions')
  preparationInstructions?: string;

  /** Enable/disable in the branch list. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
