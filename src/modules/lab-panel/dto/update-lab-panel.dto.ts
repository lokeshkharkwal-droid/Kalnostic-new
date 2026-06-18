import {
  AgeGroup,
  ReferenceGender,
  ReportType,
  SamplePriority,
  TatUnit,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { LabPanelTestDto } from './lab-panel-test.dto';

/**
 * Partial update for a lab panel — explicit optional fields (not `PartialType`;
 * SKILL.md §4). When `tests` is provided, the whole included-test set is REPLACED
 * (old active rows soft-deleted, the new set created), mirroring
 * `LabTestService.update`.
 */
export class UpdateLabPanelDto {
  @IsString()
  @IsOptional()
  @MaxLength(1024)
  bannerImage?: string;

  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(255)
  panelName?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(50)
  panelCode?: string;

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

  @IsString()
  @IsOptional()
  panelInstructions?: string;

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

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LabPanelTestDto)
  tests?: LabPanelTestDto[];
}
