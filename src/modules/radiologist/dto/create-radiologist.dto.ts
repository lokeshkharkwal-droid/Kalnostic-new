import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Create a radiologist master record. `tenantId`/`branchId` come from
 * context/JWT, never the body. `departmentId` (when supplied) is validated to
 * reference an active department in the caller's tenant by `RadiologistService`.
 */
export class CreateRadiologistDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

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
