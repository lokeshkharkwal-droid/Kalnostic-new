import {
  AgeGroup,
  ReferenceGender,
  ReportType,
  SamplePriority,
  TatUnit,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * One per-row edit: the target branch lab panel `id` plus the branch-tunable
 * fields to change for that row. Mirrors `UpdateBranchLabPanelDto` exactly —
 * only the keys present are applied; identity (`panelName`/`panelCode`) and
 * member-test composition are not bulk-editable (managed via re-import/sync).
 */
export class BulkEditBranchLabPanelItemDto {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  bannerImage?: string;

  @IsOptional()
  @IsEnum(ReferenceGender)
  applicableGender?: ReferenceGender;

  @IsOptional()
  @IsEnum(AgeGroup)
  applicableAgeGroup?: AgeGroup;

  @IsOptional()
  @IsEnum(ReportType)
  reportType?: ReportType;

  @IsOptional()
  @IsEnum(SamplePriority)
  turnaroundPriority?: SamplePriority;

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
  priceMinimum?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceMaximum?: number;

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
  commissionPrice?: number;

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
  @IsString()
  panelInstructions?: string;

  @IsOptional()
  @IsBoolean()
  isDisableDiscount?: boolean;

  @IsOptional()
  @IsBoolean()
  isEnableCms?: boolean;

  @IsOptional()
  @IsBoolean()
  isPreference?: boolean;

  @IsOptional()
  @IsBoolean()
  isFastingRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isShowOnlineBooking?: boolean;

  @IsOptional()
  @IsBoolean()
  isHomeCollection?: boolean;

  @IsOptional()
  @IsBoolean()
  isAllowPartialBilling?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxTestsRemovable?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Bulk edit for the branch Lab Panel List: an array of per-row edits, each
 * targeting its own `id` (all scoped to the caller's tenant + active branch).
 * All-or-nothing — if any item is invalid or its `id` can't be resolved, the
 * whole request fails and nothing changes. The response reports how many rows
 * were updated.
 */
export class BulkEditBranchLabPanelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkEditBranchLabPanelItemDto)
  data: BulkEditBranchLabPanelItemDto[];
}
