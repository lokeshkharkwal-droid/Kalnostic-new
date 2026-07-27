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
 * Edit a branch lab test's branch-tunable fields. Identity (`testName`/`testCode`)
 * is fixed at import (it is the branch-unique key and the snapshot's link to its
 * source); classification and the clinical snapshot are managed via re-import/sync.
 * Prices are integer minor units; cross-field price ordering is enforced by the
 * CHECK constraints in prisma/rls.sql.
 */
export class UpdateBranchLabTestDto {
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

  // Pricing
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

  // Schedule (SRS §5.1/§5.2) — days the test runs + the daily session window.
  // Feed the TAT engine's working-day filter and (future) session roll-forward.
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

  // Processing window — drives the NABL cron-managed TAT stopwatch.
  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'processingTimeFrom must be a 24h HH:mm time' })
  processingTimeFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'processingTimeTo must be a 24h HH:mm time' })
  processingTimeTo?: string;

  // Processing time (SRS §5.3)
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

  // Approval window (SRS §5.5)
  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'approvalTimeFrom must be a 24h HH:mm time' })
  approvalTimeFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(HH_MM, { message: 'approvalTimeTo must be a 24h HH:mm time' })
  approvalTimeTo?: string;

  // Flags
  @IsOptional()
  @IsBoolean()
  isHideInOrderScreen?: boolean;

  @IsOptional()
  @IsBoolean()
  isPreferenceTest?: boolean;

  // Notes
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
