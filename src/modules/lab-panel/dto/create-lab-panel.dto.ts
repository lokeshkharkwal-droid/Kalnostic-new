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
 * Create a lab panel inside a master data. `tenantId`/`branchId`/`masterDataId`
 * come from context/path, never the body. `panelCode` is client-supplied and
 * unique per master data among active rows. Included `tests` are created in the
 * same transaction. Cross-field invariants (price ordering, max-tests-removable
 * rules, test references) are validated in `LabPanelService`.
 */
export class CreateLabPanelDto {
  // ── Identity ────────────────────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  @MaxLength(1024)
  bannerImage?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  panelName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  panelCode: string;

  // ── Classification (logical refs) ─────────────────────────────────────────────
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  // ── Applicability + reporting ─────────────────────────────────────────────────
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

  // ── Status ────────────────────────────────────────────────────────────────────
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ── Pricing (integer minor units) ─────────────────────────────────────────────
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

  // ── TAT (hours by default) ────────────────────────────────────────────────────
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

  // ── Instructions ──────────────────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  panelInstructions?: string;

  // ── Flags ─────────────────────────────────────────────────────────────────────
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

  // Max tests removable in one order (0 = no limit). Only valid when
  // isAllowPartialBilling is true; bounded by the number of tests in the panel.
  @IsInt()
  @Min(0)
  @Max(1000)
  @IsOptional()
  maxTestsRemovable?: number;

  // ── Tests in panel ────────────────────────────────────────────────────────────
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LabPanelTestDto)
  tests?: LabPanelTestDto[];
}
