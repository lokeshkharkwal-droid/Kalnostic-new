import { Theme } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Editable Business Configuration fields (site URLs / branding / limits / theme).
 * All optional — this drives an upsert, so a partial payload patches only the
 * supplied fields. URL fields accept a plain string but must be a valid URL.
 */
export class UpdateTenantConfigurationDto {
  @IsUrl({ require_tld: false })
  @IsOptional()
  @MaxLength(2048)
  siteAdminUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  siteTitle?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  logoPath?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  @MaxLength(2048)
  logoLink?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  template?: string;

  @IsEnum(Theme)
  @IsOptional()
  theme?: Theme;

  @IsUrl({ require_tld: false })
  @IsOptional()
  @MaxLength(2048)
  patientOrderUrl?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxOrdersPerDayPerBranch?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUsersAllowed?: number;
}
