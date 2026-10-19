import {
  ApprovalWorkflow,
  DayOfWeek,
  RadiologyModality,
  SamplePriority,
  TatUnit,
} from '@prisma/client';
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
} from 'class-validator';
import { NoteMaxLength } from '../../../common/validators/note-max-length.validator';

/** 24-hour `HH:mm` clock time (branch-local), e.g. `08:30`. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Update a radiology test. Every field is explicitly optional (no `PartialType`,
 * per SKILL.md §4). Scope (`tenantId`/`branchId`/`masterDataId`) is never in the
 * body. Omitted fields are left unchanged; price ordering is validated against
 * the merged values in `RadiologyTestService`.
 */
export class UpdateRadiologyTestDto {
  // ── Identity ────────────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  testName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  testDisplayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  testCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  aka?: string;

  // ── Radiology-specific classification ─────────────────────────────────────────
  @IsOptional()
  @IsEnum(RadiologyModality)
  modality?: RadiologyModality;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  bodyPart?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  view?: string;

  @IsOptional()
  @IsBoolean()
  isContrast?: boolean;

  // ── Classification (logical refs) ─────────────────────────────────────────────
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  subCategoryId?: string;

  // ── Basic config ──────────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(50)
  icdCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  loincCode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clinicalTags?: string[];

  @IsOptional()
  @IsUUID()
  reportTemplateId?: string;

  @IsOptional()
  @IsEnum(SamplePriority)
  samplePriorityType?: SamplePriority;

  @IsOptional()
  @IsBoolean()
  isEnableCms?: boolean;

  @IsOptional()
  @IsEnum(ApprovalWorkflow)
  approvalWorkflow?: ApprovalWorkflow;

  // ── Pricing (integer minor units) ─────────────────────────────────────────────
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

  // ── TAT ─────────────────────────────────────────────────────────────────────
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

  // ── Schedule ──────────────────────────────────────────────────────────────────
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

  // ── Flags ─────────────────────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  isHideInOrderScreen?: boolean;

  @IsOptional()
  @IsBoolean()
  isPreferenceTest?: boolean;

  @IsOptional()
  @IsBoolean()
  isOutsource?: boolean;

  @IsOptional()
  @IsBoolean()
  isBillOnlyTest?: boolean;

  // ── Status ────────────────────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // ── Notes ─────────────────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @NoteMaxLength('Useful For')
  usefulFor?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Interpretation')
  interpretationOfResults?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Limitations')
  limitations?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Remarks')
  remarks?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('References')
  references?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Preparation Instructions')
  preparationInstructions?: string;
}
