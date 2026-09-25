import {
  AbnormalFlag,
  AgeUnit,
  ReferenceGender,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

  @IsString()
  @IsOptional()
  @MaxLength(255)
  unit?: string;

  // NULL means this range is not scoped to any analyzer ("Default"). A real
  // id scopes it to that adapter. Validated against the tenant's LabAdapter
  // rows in LabTestService (logical ref, no DB FK).
  @IsUUID('4')
  @IsOptional()
  labAdapterId?: string;

  @IsEnum(ReferenceGender)
  @IsOptional()
  gender?: ReferenceGender;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

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
