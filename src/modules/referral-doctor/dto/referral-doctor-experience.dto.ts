import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A single work-experience row for a referral doctor, embedded in create/update
 * payloads. `toDate` omitted/null means the role is current (Duration is derived
 * in the service, not stored). `tenantId`/`referralDoctorId` are NOT accepted from
 * the client — they come from the request context / parent referral doctor.
 */
export class ReferralDoctorExperienceDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  position?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  organisation?: string;

  @IsDateString()
  @IsOptional()
  fromDate?: string;

  @IsDateString()
  @IsOptional()
  toDate?: string;
}
