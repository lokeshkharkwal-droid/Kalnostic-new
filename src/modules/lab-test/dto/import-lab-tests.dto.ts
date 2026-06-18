import {
  DayOfWeek,
  ProcessMethod,
  RepeatIntervalUnit,
  SamplePriority,
  TatUnit,
} from '@prisma/client';
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
  MinLength,
} from 'class-validator';

/** 24-hour `HH:mm` clock time (branch-local), e.g. `08:30`. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One row of a lab-test bulk import (the frontend's parsed Excel row). The
 * **core/scalar** fields of a lab test — no nested samples/result parameters.
 * `testName`/`testCode` are required; everything else optional. `rowNumber` (the
 * Excel row) is echoed in validation errors; it falls back to the 1-based index.
 *
 * NOTE: rows are validated **programmatically** in `LabTestService.importAll`
 * (via class-validator's `validate()`), not by the global pipe, so that errors
 * can be aggregated per row. The wrapping `ImportLabTestsDto` therefore does not
 * `@ValidateNested` these.
 */
export class ImportLabTestRowDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  rowNumber?: number;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  testName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  testCode: string;

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
 * Bulk import for lab tests: an array of parsed Excel rows to **create** in a
 * master data (create-only — no update). Every row is validated before anything
 * is saved; if any row fails (structural, cross-field, or a duplicate
 * `testName`/`testCode` against the batch or existing active tests) the whole
 * import fails with a row-numbered message list and nothing is persisted.
 *
 * The rows are deliberately NOT `@ValidateNested` here so the global pipe only
 * enforces the array envelope; `LabTestService.importAll` validates each row to
 * aggregate per-row errors.
 */
export class ImportLabTestsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  rows: ImportLabTestRowDto[];
}
