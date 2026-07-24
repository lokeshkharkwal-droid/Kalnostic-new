import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Allowed values for `duplicateCheckStrategy`. */
export const PATIENT_DUPLICATE_CHECK_STRATEGIES = [
  'Mobile + DOB',
  'Mobile only',
  'Mobile + Name',
] as const;

/** Allowed values for `defaultTitle`. */
export const PATIENT_DEFAULT_TITLES = [
  'Mr.',
  'Mrs.',
  'Ms.',
  'Dr.',
  '—',
] as const;

/** Allowed values for `dataRetentionPeriod`. */
export const PATIENT_DATA_RETENTION_PERIODS = [
  '1 year',
  '3 years',
  '5 years',
  'Indefinite',
] as const;

/**
 * Save/upsert payload for Registration patient settings. All fields are
 * optional so the frontend can patch a single card or submit the whole form.
 */
export class SavePatientSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9{}\-_]+$/, {
    message: 'patientIdFormat may only contain letters, digits, { } - _',
  })
  patientIdFormat?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999999)
  nextPatientNumber?: number;

  @IsOptional()
  @IsIn(PATIENT_DUPLICATE_CHECK_STRATEGIES)
  duplicateCheckStrategy?: (typeof PATIENT_DUPLICATE_CHECK_STRATEGIES)[number];

  @IsOptional()
  @IsIn(PATIENT_DEFAULT_TITLES)
  defaultTitle?: (typeof PATIENT_DEFAULT_TITLES)[number];

  @IsOptional()
  @IsBoolean()
  isMobileNumberMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmailMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  isDobMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  isGenderMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  isAddressMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  isIdProofNumberMandatory?: boolean;

  @IsOptional()
  @IsBoolean()
  isDigitalConsentCaptureEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isMobileMaskingInPrintoutsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isWhatsappReportSharingEnabled?: boolean;

  @IsOptional()
  @IsIn(PATIENT_DATA_RETENTION_PERIODS)
  dataRetentionPeriod?: (typeof PATIENT_DATA_RETENTION_PERIODS)[number];
}
