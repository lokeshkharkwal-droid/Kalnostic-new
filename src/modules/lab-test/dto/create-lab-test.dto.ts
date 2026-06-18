import {
  DayOfWeek,
  ProcessMethod,
  RepeatIntervalUnit,
  SamplePriority,
  TatUnit,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { LabTestSampleDto } from './lab-test-sample.dto';
import { LabTestResultParamDto } from './lab-test-result-param.dto';

/** 24-hour `HH:mm` clock time (branch-local), e.g. `08:30`. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Create a lab test inside a master data. `tenantId`/`branchId`/`masterDataId`
 * come from context/path, never the body. `testCode` is client-supplied (unlike
 * branch/department codes) and unique per master data among active rows. Children
 * (`samples`, `resultParams`) are created in the same transaction. Cross-field
 * invariants (price ordering, mandatory-dept-required, repeat-interval-required,
 * calc-formula-required) are validated in `LabTestService`.
 */
export class CreateLabTestDto {
  // ── Identity ────────────────────────────────────────────────────────────────
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  testName: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  testDisplayName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  testCode: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  aka?: string;

  // ── Classification (logical refs) ─────────────────────────────────────────────
  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  subCategoryId?: string;

  // ── Basic config ──────────────────────────────────────────────────────────────
  @IsEnum(ProcessMethod)
  @IsOptional()
  processMethod?: ProcessMethod;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  icdCode?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  loincCode?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  clinicalTags?: string[];

  @IsUUID()
  @IsOptional()
  reportTemplateId?: string;

  @IsEnum(SamplePriority)
  @IsOptional()
  samplePriorityType?: SamplePriority;

  @IsUUID()
  @IsOptional()
  pdfSettingsId?: string;

  @IsUUID()
  @IsOptional()
  imageSettingsId?: string;

  @IsBoolean()
  @IsOptional()
  isEnableCms?: boolean;

  @IsUUID()
  @IsOptional()
  approvalWorkflowId?: string;

  // ── Pricing (integer minor units) ─────────────────────────────────────────────
  @IsInt()
  @Min(0)
  @IsOptional()
  priceMsrp?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  priceMaximum?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  priceMinimum?: number;

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
  emergencyPrice?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  commissionPrice?: number;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  discountCapPct?: number;

  @IsBoolean()
  @IsOptional()
  isAllowPriceOverride?: boolean;

  @IsBoolean()
  @IsOptional()
  isAllowDiscounts?: boolean;

  // ── TAT ─────────────────────────────────────────────────────────────────────
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

  // ── Schedule ──────────────────────────────────────────────────────────────────
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  @ArrayUnique()
  @IsOptional()
  scheduleDays?: DayOfWeek[];

  @IsString()
  @Matches(HH_MM, { message: 'scheduleFrom must be a 24h HH:mm time' })
  @IsOptional()
  scheduleFrom?: string;

  @IsString()
  @Matches(HH_MM, { message: 'scheduleTo must be a 24h HH:mm time' })
  @IsOptional()
  scheduleTo?: string;

  // ── Processing time ───────────────────────────────────────────────────────────
  @IsInt()
  @Min(0)
  @IsOptional()
  procTimeMinValue?: number;

  @IsEnum(TatUnit)
  @IsOptional()
  procTimeMinUnit?: TatUnit;

  @IsInt()
  @Min(0)
  @IsOptional()
  procTimeMaxValue?: number;

  @IsEnum(TatUnit)
  @IsOptional()
  procTimeMaxUnit?: TatUnit;

  // ── Approval window ───────────────────────────────────────────────────────────
  @IsString()
  @Matches(HH_MM, { message: 'approvalTimeFrom must be a 24h HH:mm time' })
  @IsOptional()
  approvalTimeFrom?: string;

  @IsString()
  @Matches(HH_MM, { message: 'approvalTimeTo must be a 24h HH:mm time' })
  @IsOptional()
  approvalTimeTo?: string;

  // ── Flags ─────────────────────────────────────────────────────────────────────
  @IsBoolean()
  @IsOptional()
  isHideInOrderScreen?: boolean;

  @IsBoolean()
  @IsOptional()
  isPreferenceTest?: boolean;

  @IsBoolean()
  @IsOptional()
  isMandatoryTest?: boolean;

  @IsUUID()
  @IsOptional()
  mandatoryDeptId?: string;

  @IsUUID()
  @IsOptional()
  mandatoryCatId?: string;

  @IsUUID()
  @IsOptional()
  mandatorySubcatId?: string;

  @IsBoolean()
  @IsOptional()
  isRepeatIntervalRestriction?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  repeatIntervalValue?: number;

  @IsEnum(RepeatIntervalUnit)
  @IsOptional()
  repeatIntervalUnit?: RepeatIntervalUnit;

  // ── Status ────────────────────────────────────────────────────────────────────
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ── Notes ─────────────────────────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  usefulFor?: string;

  @IsString()
  @IsOptional()
  interpretationOfResults?: string;

  @IsString()
  @IsOptional()
  limitations?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsString()
  @IsOptional()
  references?: string;

  // ── Children ──────────────────────────────────────────────────────────────────
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LabTestSampleDto)
  samples?: LabTestSampleDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LabTestResultParamDto)
  resultParams?: LabTestResultParamDto[];
}
