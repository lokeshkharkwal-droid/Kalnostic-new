import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateTenantLocaleDto } from './tenant-settings.dto';

/**
 * Editable tenant fields. Slug is immutable (advertised subdomain) and admin
 * fields are managed separately, so neither appears here.
 */
export class UpdateTenantDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  shortName?: string;

  /** Optional custom domain (must be globally unique). Empty string clears it. */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  customDomain?: string;

  // ── Registered address ──
  @IsObject()
  @IsOptional()
  address?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  addressLine?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  pincode?: string;

  @IsUUID()
  @IsOptional()
  countryId?: string;

  @IsUUID()
  @IsOptional()
  stateId?: string;

  @IsUUID()
  @IsOptional()
  cityId?: string;

  @IsUUID()
  @IsOptional()
  areaId?: string;

  // ── Media (URL strings) ──
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  logoUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  photoUrl?: string;

  /** Partial locale settings; supplied timezone/currency are still validated. */
  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateTenantLocaleDto)
  settings?: UpdateTenantLocaleDto;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  mrnPrefix?: string;
}
