import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Partial update for a radiologist. All fields optional (explicit, not
 * `PartialType`, per SKILL.md). `departmentId` is re-validated when supplied.
 */
export class UpdateRadiologistDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  speciality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  qualification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobile?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
