import { AbnormalFlag, AgeUnit, ReferenceGender } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A numeric reference range for a result parameter, embedded under a
 * `LabTestResultParamDto`. `tenantId`/`branchId`/`labTestId`/`paramId` are NOT
 * accepted from the client — they come from context / the parent. Cross-field
 * bounds (lower ≤ upper, critical bounds, age_from ≤ age_to) are validated in
 * `LabTestService` and enforced by CHECK constraints in prisma/rls.sql.
 */
export class LabTestReferenceRangeDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  method?: string;

  @IsEnum(ReferenceGender)
  @IsOptional()
  gender?: ReferenceGender;

  @IsInt()
  @Min(0)
  @IsOptional()
  ageFrom?: number;

  @IsEnum(AgeUnit)
  @IsOptional()
  ageFromUnit?: AgeUnit;

  @IsInt()
  @Min(0)
  @IsOptional()
  ageTo?: number;

  @IsEnum(AgeUnit)
  @IsOptional()
  ageToUnit?: AgeUnit;

  @IsNumber()
  @IsOptional()
  lowerLimit?: number;

  @IsNumber()
  @IsOptional()
  upperLimit?: number;

  @IsNumber()
  @IsOptional()
  criticalMin?: number;

  @IsNumber()
  @IsOptional()
  criticalMax?: number;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  displayOfReferenceRange?: string;

  @IsEnum(AbnormalFlag)
  @IsOptional()
  abnormalFlagLogic?: AbnormalFlag;
}
