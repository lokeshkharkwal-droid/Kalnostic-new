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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One per-row edit: the target branch radiology panel `id` plus the branch-tunable
 * fields to change. Mirrors `UpdateBranchRadiologyPanelDto` — identity and
 * member-test composition are not bulk-editable.
 */
export class BulkEditBranchRadiologyPanelItemDto {
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
 * Bulk edit for the branch Radiology Panel List: an array of per-row edits, each
 * targeting its own `id` (all scoped to the caller's tenant + active branch).
 * All-or-nothing.
 */
export class BulkEditBranchRadiologyPanelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkEditBranchRadiologyPanelItemDto)
  data: BulkEditBranchRadiologyPanelItemDto[];
}
