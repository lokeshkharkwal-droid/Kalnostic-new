import {
  IsEmail,
  IsNotEmpty,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TenantSettingsDto } from './tenant-settings.dto';

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

  /**
   * Phone is the admin's login identifier — must be globally unique. Stored as
   * a plain 10-digit national number (no country code); the country code is
   * kept only on the business contact `phone` below.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10}$/, {
    message: 'adminPhone must be a 10-digit mobile number',
  })
  adminPhone: string;

  @IsEmail()
  @IsOptional()
  adminEmail?: string;

  /**
   * The business admin's login password, chosen by SiteAdmin. Policy: min 8
   * chars, ≥1 uppercase, ≥1 digit (§5.3). Stored bcrypt-hashed; not a temp
   * password (the admin need not change it on first login).
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'adminPassword must be at least 8 characters long' })
  @Matches(/[A-Z]/, {
    message: 'adminPassword must contain at least one uppercase letter',
  })
  @Matches(/[0-9]/, {
    message: 'adminPassword must contain at least one number',
  })
  adminPassword: string;

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

  /**
   * Locale settings (time zone + currency are required; date_format/language
   * defaulted by the service). Validated against the supported shortlists.
   */
  @IsObject()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => TenantSettingsDto)
  settings: TenantSettingsDto;

  /** MRN prefix for this business's patients (e.g. "CD" → "CD-00001"). */
  @IsString()
  @IsOptional()
  @MaxLength(10)
  mrnPrefix?: string;
}
