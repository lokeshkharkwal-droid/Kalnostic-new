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
 * One per-panel edit: the target `labPanelId` plus the scalar fields to change for
 * that panel. Included `tests` (composition) and `panelName`/`panelCode` are
 * intentionally NOT bulk-editable. Only the keys present are applied; cross-field
 * invariants are re-checked per panel in `LabPanelService`.
 */
export class BulkEditLabPanelItemDto {
  @IsUUID()
  labPanelId: string;

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
 * Bulk edit for lab panels: an array of per-panel edits, each targeting its own
 * `labPanelId` (all scoped to the caller's tenant + the path's master data).
 * All-or-nothing — if any item is invalid or its `labPanelId` can't be resolved,
 * the whole request fails and nothing changes. The response reports how many rows
 * were updated.
 */
export class BulkEditLabPanelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkEditLabPanelItemDto)
  data: BulkEditLabPanelItemDto[];
}
