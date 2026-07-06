import { SupportStatus, SupportTenantType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * All fields optional; mirrors CreateSupportInfoDto (explicit optionals, not
 * `PartialType` — SKILL.md convention). A changed `title` is re-validated for
 * uniqueness in the service.
 */
export class UpdateSupportInfoDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  metaType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  code?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsEnum(SupportTenantType)
  @IsOptional()
  tenantType?: SupportTenantType;

  @IsEnum(SupportStatus)
  @IsOptional()
  status?: SupportStatus;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  requestUrl?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  helpContent?: string;
}
