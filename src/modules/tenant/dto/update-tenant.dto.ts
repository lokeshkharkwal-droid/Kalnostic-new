import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TenantSettings } from '../entities/tenant.entity';

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

  @IsObject()
  @IsOptional()
  address?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  settings?: Partial<TenantSettings>;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  mrnPrefix?: string;
}
