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
 * A numeric reference range for a opd result parameter, embedded under a
 * `OpdTestResultParamDto`. Context/parent ids are not accepted from the
 * client. Cross-field bounds are validated in `OpdTestService`.
 */
export class OpdTestReferenceRangeDto {
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
