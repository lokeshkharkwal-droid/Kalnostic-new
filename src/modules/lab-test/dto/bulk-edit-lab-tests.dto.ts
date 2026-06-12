import {
  DayOfWeek,
  ProcessMethod,
  RepeatIntervalUnit,
  SamplePriority,
  TatUnit,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';

/** 24-hour `HH:mm` clock time (branch-local), e.g. `08:30`. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One per-test edit: the target `labTestId` plus the scalar fields to change for
 * that test. Children (`samples`/`resultParams`) and identity (`testName`/
 * `testCode`) are intentionally NOT bulk-editable — use the single-test update for
 * those. Only the keys present are applied; cross-field invariants are re-checked
 * per test in `LabTestService`.
 */
export class BulkEditLabTestItemDto {
  @IsUUID()
  labTestId: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  testDisplayName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  aka?: string;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  subCategoryId?: string;

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
  @Max(100)
  @IsOptional()
  discountCapPct?: number;

  @IsBoolean()
  @IsOptional()
  isAllowPriceOverride?: boolean;

  @IsBoolean()
  @IsOptional()
  isAllowDiscounts?: boolean;

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

  @IsString()
  @Matches(HH_MM, { message: 'approvalTimeFrom must be a 24h HH:mm time' })
  @IsOptional()
  approvalTimeFrom?: string;

  @IsString()
  @Matches(HH_MM, { message: 'approvalTimeTo must be a 24h HH:mm time' })
  @IsOptional()
  approvalTimeTo?: string;

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

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

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
}

/**
 * Bulk edit for lab tests: an array of per-test edits, each targeting its own
 * `labTestId` (all scoped to the caller's tenant + the path's master data).
 * All-or-nothing — if any item is invalid or its `labTestId` can't be resolved,
 * the whole request fails and nothing changes. The response reports how many rows
 * were updated.
 */
export class BulkEditLabTestsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkEditLabTestItemDto)
  data: BulkEditLabTestItemDto[];
}
