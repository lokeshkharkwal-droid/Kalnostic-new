import {
  ParameterType,
  ResultEntryMode,
  ResultRounding,
  ResultType,
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
import { LabTestReferenceRangeDto } from './lab-test-reference-range.dto';
import { LabTestReferenceValueDto } from './lab-test-reference-value.dto';

/**
 * A result parameter for a lab test, embedded under the create/update payload.
 * Embeds its own reference ranges/values. Context/parent ids are not accepted
 * from the client. `parameterCode` is unique per test (partial unique index);
 * `calculationFormula` is required when `parameterType` is `CALCULATED`
 * (validated in `LabTestService` + a CHECK in prisma/rls.sql).
 */
export class LabTestResultParamDto {
  // Group display
  @IsString()
  @IsOptional()
  @MaxLength(255)
  groupName?: string;

  @IsUUID()
  @IsOptional()
  groupLayoutId?: string;

  @IsUUID()
  @IsOptional()
  groupSettingsId?: string;

  // Parameter identity
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  parameterName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  parameterCode: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  method?: string;

  @IsString()
  @IsOptional()
  attachFileUrl?: string;

  @IsUUID()
  @IsOptional()
  iconSettingsId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  reportingUnit?: string;

  // Result behaviour
  @IsEnum(ResultType)
  resultType: ResultType;

  @IsEnum(ParameterType)
  @IsOptional()
  parameterType?: ParameterType;

  @IsEnum(ResultEntryMode)
  @IsOptional()
  resultEntryMode?: ResultEntryMode;

  @IsString()
  @IsOptional()
  calculationFormula?: string;

  @IsEnum(ResultRounding)
  @IsOptional()
  resultRoundingType?: ResultRounding;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  allowableUnits?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  decimalPlaces?: number;

  // Reflex tests (LabTest ids)
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  reflexTestIds?: string[];

  // Meta
  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isNabl?: boolean;

  @IsBoolean()
  @IsOptional()
  isCap?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  // Reference ranges / values (created with the parameter)
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LabTestReferenceRangeDto)
  referenceRanges?: LabTestReferenceRangeDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => LabTestReferenceValueDto)
  referenceValues?: LabTestReferenceValueDto[];
}
