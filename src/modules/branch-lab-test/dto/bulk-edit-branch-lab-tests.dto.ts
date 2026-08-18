import { DayOfWeek, SamplePriority, TatUnit } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** 24h `HH:mm` time-of-day (00:00–23:59). */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One per-row edit: the target branch lab test `id` plus the branch-tunable
 * fields to change for that row. Mirrors `UpdateBranchLabTestDto` exactly — only
 * the keys present are applied; identity (`testName`/`testCode`), classification,
 * and the clinical snapshot are not bulk-editable (managed via re-import/sync).
 */
export class BulkEditBranchLabTestItemDto {
  @IsUUID()
  id: string;

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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Bulk edit for the branch Lab Test List: an array of per-row edits, each
 * targeting its own `id` (all scoped to the caller's tenant + active branch).
 * All-or-nothing — if any item is invalid or its `id` can't be resolved, the
 * whole request fails and nothing changes. The response reports how many rows
 * were updated.
 */
export class BulkEditBranchLabTestsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkEditBranchLabTestItemDto)
  data: BulkEditBranchLabTestItemDto[];
}
