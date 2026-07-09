import { SupportStatus, SupportTenantType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Payload for creating a support-information record. `code` is user-supplied and
 * NOT unique; `title` must be globally unique among active rows (enforced in the
 * service + a partial unique index). `helpContent` holds the full HTML body.
 */
export class CreateSupportInfoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  metaType: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  code?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @IsEnum(SupportTenantType)
  tenantType: SupportTenantType;

  @IsEnum(SupportStatus)
  @IsOptional()
  status?: SupportStatus;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  requestUrl?: string;

  @IsString()
  @MinLength(1)
  helpContent: string;
}
