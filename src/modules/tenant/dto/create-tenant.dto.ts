import {
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
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
  adminMiddleName?: string;

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

  /**
   * Subdomain slug ({slug}.kalnostics.com). Lowercase alphanumeric + hyphens.
   * Optional — when omitted, a unique slug is auto-generated from `name`
   * (the field is managed as "Site Title" in Business Configuration).
   */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/, {
    message:
      'Slug must be lowercase alphanumeric (hyphens allowed, not at start/end)',
  })
  slug?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  /** Business abbreviation / short name. */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  shortName?: string;

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

  /** Location hierarchy (Country → State → City → Area/locality). */
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

  @IsObject()
  @IsOptional()
  settings?: Partial<TenantSettings>;

  /** MRN prefix for this business's patients (e.g. "CD" → "CD-00001"). */
  @IsString()
  @IsOptional()
  @MaxLength(10)
  mrnPrefix?: string;
}
