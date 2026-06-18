import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A single qualification row for a referral doctor, embedded in create/update
 * payloads. `tenantId`/`referralDoctorId` are NOT accepted from the client — they
 * come from the request context / parent referral doctor.
 */
export class ReferralDoctorQualificationDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  qualificationType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  degreeName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  institutionName?: string;

  @IsInt()
  @IsOptional()
  @Min(1900)
  @Max(2100)
  yearOfCompletion?: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  percentageGrade?: string;
}
