import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A single work engagement for a doctor, embedded in create/update payloads.
 * `toDate` omitted/null means the role is current. `tenantId`/`doctorId` are NOT
 * accepted from the client — they come from the request context / parent doctor.
 */
export class DoctorExperienceDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  organisation?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  rolePosition?: string;

  @IsDateString()
  @IsOptional()
  fromDate?: string;

  @IsDateString()
  @IsOptional()
  toDate?: string;
}
