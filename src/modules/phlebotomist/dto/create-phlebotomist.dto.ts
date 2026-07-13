import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Create a phlebotomist master record. `tenantId`/`branchId` come from
 * context/JWT, never the body.
 */
export class CreatePhlebotomistDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  designation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobile?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
