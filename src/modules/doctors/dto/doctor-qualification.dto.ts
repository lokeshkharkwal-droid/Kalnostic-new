import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A single qualification (degree) for a doctor, embedded in create/update
 * payloads. `tenantId`/`doctorId` are NOT accepted from the client — they come
 * from the request context / parent doctor.
 */
export class DoctorQualificationDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  degree?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  institution?: string;

  @IsInt()
  @IsOptional()
  @Min(1900)
  @Max(2100)
  yearOfPassing?: number;
}
