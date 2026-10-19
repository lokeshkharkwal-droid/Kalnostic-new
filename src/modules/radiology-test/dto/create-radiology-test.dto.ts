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
 * Create a radiology test inside a master data. `tenantId`/`branchId`/
 * `masterDataId` come from context/path, never the body. `testCode` is
 * client-supplied and unique per master data among active rows. The radiology
 * model is FLAT — no nested samples/result parameters — so the payload is a
 * single scalar object. Cross-field invariants (price ordering) are validated in
 * `RadiologyTestService`.
 */
export class CreateRadiologyTestDto {
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

  // ── Radiology-specific classification ─────────────────────────────────────────
  @IsEnum(RadiologyModality)
  @IsOptional()
  modality?: RadiologyModality;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  bodyPart?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  view?: string;

  @IsBoolean()
  @IsOptional()
  isContrast?: boolean;

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

  @IsBoolean()
  @IsOptional()
  isEnableCms?: boolean;

  @IsEnum(ApprovalWorkflow)
  @IsOptional()
  approvalWorkflow?: ApprovalWorkflow;

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

  // ── Flags ─────────────────────────────────────────────────────────────────────
  @IsBoolean()
  @IsOptional()
  isHideInOrderScreen?: boolean;

  @IsBoolean()
  @IsOptional()
  isPreferenceTest?: boolean;

  @IsBoolean()
  @IsOptional()
  isOutsource?: boolean;

  @IsBoolean()
  @IsOptional()
  isBillOnlyTest?: boolean;

  // ── Status ────────────────────────────────────────────────────────────────────
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ── Notes ─────────────────────────────────────────────────────────────────────
  @IsString()
  @IsOptional()
  @NoteMaxLength('Useful For')
  usefulFor?: string;

  @IsString()
  @IsOptional()
  @NoteMaxLength('Interpretation')
  interpretationOfResults?: string;

  @IsString()
  @IsOptional()
  @NoteMaxLength('Limitations')
  limitations?: string;

  @IsString()
  @IsOptional()
  @NoteMaxLength('Remarks')
  remarks?: string;

  @IsString()
  @IsOptional()
  @NoteMaxLength('References')
  references?: string;

  @IsString()
  @IsOptional()
  @NoteMaxLength('Preparation Instructions')
  preparationInstructions?: string;
}
