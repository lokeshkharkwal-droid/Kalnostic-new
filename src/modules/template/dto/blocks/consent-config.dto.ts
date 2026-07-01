import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Consent-form layout flags. Persisted inside `Template.config.consent`.
 * `hospitalLogoFile` / `referenceDocFile` hold filename/key strings only.
 */
export class ConsentBlockDto {
  @IsBoolean()
  showHospitalHeader: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  hospitalLogoFile?: string;

  @IsString()
  @MaxLength(255)
  hospitalName: string;

  @IsBoolean()
  patientSignature: boolean;

  @IsBoolean()
  doctorSignature: boolean;

  @IsBoolean()
  showDate: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  referenceDocFile?: string;
}

/**
 * CONSENT_FORM type-specific payload. Stored as `Template.config` for consent
 * templates: `{ signatureRequired, consent: { … } }`.
 */
export class ConsentConfigDto {
  @IsBoolean()
  signatureRequired: boolean;

  @ValidateNested()
  @Type(() => ConsentBlockDto)
  consent: ConsentBlockDto;
}
