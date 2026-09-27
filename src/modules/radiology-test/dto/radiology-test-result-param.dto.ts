import {
  ParameterType,
  ResultEntryMode,
  ResultGroupLayout,
  ResultRounding,
  ResultType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RadiologyTestReferenceRangeDto } from './radiology-test-reference-range.dto';
import { RadiologyTestReferenceValueDto } from './radiology-test-reference-value.dto';
import { ReflexTestRefDto } from './reflex-test-ref.dto';

/**
 * A result parameter for a radiology test, embedded under the create/update
 * payload. Embeds its own reference ranges/values. Context/parent ids are not
 * accepted from the client. `parameterCode` is unique per test.
 */
export class RadiologyTestResultParamDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  groupName?: string;

  @IsEnum(ResultGroupLayout)
  @IsOptional()
  groupLayout?: ResultGroupLayout;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  groupLayoutId?: string;

  @IsUUID()
  @IsOptional()
  groupSettingsId?: string;

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

  @IsUUID()
  @IsOptional()
  imageSettingsId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  reportingUnit?: string;

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

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  resultSuggestions?: string[];

  @IsString()
  @IsOptional()
  defaultValue?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  decimalPlaces?: number;

  @IsNumber()
  @IsOptional()
  criticalMin?: number;

  @IsNumber()
  @IsOptional()
  criticalMax?: number;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ReflexTestRefDto)
  reflexTests?: ReflexTestRefDto[];

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? Array.from(new Set(value)) : value,
  )
  overallResultGroups?: string[];

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

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RadiologyTestReferenceRangeDto)
  referenceRanges?: RadiologyTestReferenceRangeDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RadiologyTestReferenceValueDto)
  referenceValues?: RadiologyTestReferenceValueDto[];
}
