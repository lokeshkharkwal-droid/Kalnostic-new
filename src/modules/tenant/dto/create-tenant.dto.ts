import {
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { TenantSettings } from '../entities/tenant.entity';

/**
 * Payload to create a tenant (business) + its first business-admin user.
 * Invoked by SiteAdmin.
 */
export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  // ── Business admin (first user) ──
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  adminFirstName: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  adminLastName?: string;

  /** Phone is the admin's login identifier — must be globally unique. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  adminPhone: string;

  @IsEmail()
  @IsOptional()
  adminEmail?: string;

  /** Subdomain slug ({slug}.kalnostics.com). Lowercase alphanumeric + hyphens. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/, {
    message: 'Slug must be lowercase alphanumeric (hyphens allowed, not at start/end)',
  })
  slug: string;

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

  /** MRN prefix for this business's patients (e.g. "CD" → "CD-00001"). */
  @IsString()
  @IsOptional()
  @MaxLength(10)
  mrnPrefix?: string;
}
