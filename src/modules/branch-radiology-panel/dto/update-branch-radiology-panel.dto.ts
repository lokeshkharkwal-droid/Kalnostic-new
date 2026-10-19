import {
  AgeGroup,
  ReferenceGender,
  ReportType,
  SamplePriority,
  TatUnit,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

/**
 * Edit a branch radiology panel's branch-tunable fields. Identity (`panelName`/
 * `panelCode`) and member-test composition are fixed at import (managed via
 * re-import/sync). Prices are integer minor units; cross-field price ordering is
 * enforced by the CHECK constraints in prisma/rls.sql (and by the service).
 */
export class UpdateBranchRadiologyPanelDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  bannerImage?: string;

  // Applicability + reporting
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

  // Instructions
  @IsOptional()
  @IsString()
  panelInstructions?: string;

  // Flags
  @IsOptional()
  @IsBoolean()
  isDisableDiscount?: boolean;

  /** Billed but never enters the imaging workflow (no accession/report). */
  @IsOptional()
  @IsBoolean()
  isBillOnlyTest?: boolean;

  @IsOptional()
  @IsBoolean()
  isEnableCms?: boolean;

  @IsOptional()
  @IsBoolean()
  isPreference?: boolean;

  @IsOptional()
  @IsBoolean()
  isShowOnlineBooking?: boolean;

  /** Enable/disable in the branch list. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
