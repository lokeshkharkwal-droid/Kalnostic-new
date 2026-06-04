import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  /** Phone, email, or system username (auth tries each). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  identifier: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  password: string;

  /** Tenant slug — required for staff login (sets tenant context). */
  @IsString()
  @IsOptional()
  tenantSlug?: string;
}
