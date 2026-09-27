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

/** 24h `HH:mm` time-of-day (00:00–23:59). */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Edit a branch opd test's branch-tunable fields. Identity
 * (`testName`/`testCode`) is fixed at import; classification and the clinical
 * snapshot are managed via re-import/sync. Prices are integer minor units.
 */
export class UpdateBranchOpdTestDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  testDisplayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  aka?: string;

  @IsOptional()
  @IsEnum(SamplePriority)
  samplePriorityType?: SamplePriority;

  @IsOptional()
  @IsBoolean()
  isEnableCms?: boolean;

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

  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'processingTimeFrom must be a 24h HH:mm time' })
  processingTimeFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'processingTimeTo must be a 24h HH:mm time' })
  processingTimeTo?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  procTimeMinValue?: number;

  @IsOptional()
  @IsEnum(TatUnit)
  procTimeMinUnit?: TatUnit;

  @IsOptional()
  @IsInt()
  @Min(0)
  procTimeMaxValue?: number;

  @IsOptional()
  @IsEnum(TatUnit)
  procTimeMaxUnit?: TatUnit;

  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'approvalTimeFrom must be a 24h HH:mm time' })
  approvalTimeFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'approvalTimeTo must be a 24h HH:mm time' })
  approvalTimeTo?: string;

  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'reportingTimeFrom must be a 24h HH:mm time' })
  reportingTimeFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'reportingTimeTo must be a 24h HH:mm time' })
  reportingTimeTo?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  approvalDurationMinValue?: number;

  @IsOptional()
  @IsEnum(TatUnit)
  approvalDurationMinUnit?: TatUnit;

  @IsOptional()
  @IsInt()
  @Min(0)
  approvalDurationMaxValue?: number;

  @IsOptional()
  @IsEnum(TatUnit)
  approvalDurationMaxUnit?: TatUnit;

  @IsOptional()
  @IsBoolean()
  isHideInOrderScreen?: boolean;

  @IsOptional()
  @IsBoolean()
  isPreferenceTest?: boolean;

  @IsOptional()
  @IsString()
  usefulFor?: string;

  @IsOptional()
  @IsString()
  interpretationOfResults?: string;

  @IsOptional()
  @IsString()
  limitations?: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsString()
  references?: string;

  /** Enable/disable in the branch list. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
