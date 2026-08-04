import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Curated IANA time zones a business may be configured with. Kept as a small,
 * real-world shortlist (not the full IANA database) — it is the single source
 * that also backs the Site Admin time-zone dropdown. Values are validated on
 * write so an unsupported zone can never be stored.
 */
export const SUPPORTED_TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
] as const;

/** Currencies a business may be configured with (ISO 4217). Mirrors the Site
 * Admin currency dropdown; validated on write. */
export const SUPPORTED_CURRENCIES = [
  'INR',
  'USD',
  'GBP',
  'EUR',
  'AED',
  'SGD',
  'AUD',
  'CAD',
  'PKR',
  'BDT',
  'LKR',
  'NPR',
] as const;

/**
 * Locale settings carried inside a tenant's `settings` JSON. Time zone and
 * currency are **required** and constrained to the supported shortlists;
 * `date_format` / `language` are optional (defaulted by the service).
 */
export class TenantSettingsDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([...SUPPORTED_TIMEZONES], {
    message: 'timezone must be a supported IANA time zone',
  })
  timezone: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([...SUPPORTED_CURRENCIES], {
    message: 'currency must be a supported ISO 4217 currency code',
  })
  currency: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  date_format?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  language?: string;
}

/**
 * Partial locale settings for tenant updates — every field optional, but any
 * supplied `timezone` / `currency` is still validated against the supported
 * lists so a bad value cannot slip in via a partial edit.
 */
export class UpdateTenantLocaleDto {
  @IsString()
  @IsOptional()
  @IsIn([...SUPPORTED_TIMEZONES], {
    message: 'timezone must be a supported IANA time zone',
  })
  timezone?: string;

  @IsString()
  @IsOptional()
  @IsIn([...SUPPORTED_CURRENCIES], {
    message: 'currency must be a supported ISO 4217 currency code',
  })
  currency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  date_format?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  language?: string;
}
