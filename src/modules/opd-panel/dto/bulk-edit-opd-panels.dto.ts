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
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One per-panel edit: the target `panelId` plus the scalar fields to change.
 * Included `tests` (composition) and `panelName`/`panelCode` are NOT bulk-editable.
 */
export class BulkEditOpdPanelItemDto {
  @IsUUID()
  panelId: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsEnum(ReferenceGender)
  @IsOptional()
  applicableGender?: ReferenceGender;

  @IsEnum(AgeGroup)
  @IsOptional()
  applicableAgeGroup?: AgeGroup;

  @IsEnum(ReportType)
  @IsOptional()
  reportType?: ReportType;

  @IsEnum(SamplePriority)
  @IsOptional()
  turnaroundPriority?: SamplePriority;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  priceMsrp?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  priceMinimum?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  priceMaximum?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  priceOriginal?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  franchisePrice?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  commissionPrice?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  tatMinValue?: number;

  @IsEnum(TatUnit)
  @IsOptional()
  tatMinUnit?: TatUnit;

  @IsInt()
  @Min(0)
  @IsOptional()
  tatMaxValue?: number;

  @IsEnum(TatUnit)
  @IsOptional()
  tatMaxUnit?: TatUnit;

  @IsBoolean()
  @IsOptional()
  isDisableDiscount?: boolean;

  @IsBoolean()
  @IsOptional()
  isEnableCms?: boolean;

  @IsBoolean()
  @IsOptional()
  isPreference?: boolean;

  @IsBoolean()
  @IsOptional()
  isFastingRequired?: boolean;

  @IsBoolean()
  @IsOptional()
  isShowOnlineBooking?: boolean;

  @IsBoolean()
  @IsOptional()
  isHomeCollection?: boolean;

  @IsBoolean()
  @IsOptional()
  isAllowPartialBilling?: boolean;

  @IsInt()
  @Min(0)
  @Max(1000)
  @IsOptional()
  maxTestsRemovable?: number;
}

/**
 * Bulk edit for opd panels: an array of per-panel edits, each targeting its
 * own `panelId` (all scoped to the caller's tenant + the path's master data).
 * All-or-nothing.
 */
export class BulkEditOpdPanelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkEditOpdPanelItemDto)
  data: BulkEditOpdPanelItemDto[];
}
