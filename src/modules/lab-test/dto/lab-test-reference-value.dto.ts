import { AbnormalFlag, AgeUnit, ReferenceGender } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * A qualitative reference value (e.g. "Negative") for a result parameter,
 * embedded under a `LabTestResultParamDto`. Context/parent ids are not accepted
 * from the client. `age_from ≤ age_to` is enforced by a CHECK in prisma/rls.sql.
 */
export class LabTestReferenceValueDto {
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

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  normalValueText: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  displayOfReferenceRange?: string;

  @IsEnum(AbnormalFlag)
  @IsOptional()
  abnormalFlagLogic?: AbnormalFlag;

  /**
   * Position of this row in the test's whole Reference Value list (the
   * Master Data editor's drag-to-reorder order, which spans every parameter).
   * Optional: a client that omits it leaves a kept row's order unchanged and
   * gives a new row 0 (ordered by creation).
   */
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
