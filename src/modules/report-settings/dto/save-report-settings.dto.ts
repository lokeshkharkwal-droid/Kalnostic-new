import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const LOGO_POSITIONS = ['Left', 'Center', 'Right'] as const;
export const PAGE_SIZES = ['A4', 'Letter', 'A5'] as const;
export const PDF_WATERMARKS = ['None', 'DRAFT', 'FINAL', 'DUPLICATE'] as const;

/**
 * Save/upsert payload for Registration report settings. All fields are
 * optional so the frontend can patch a single card or submit the whole form.
 */
export class SaveReportSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  labNameOnHeader?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  tagLine?: string;

  @IsOptional()
  @IsIn(LOGO_POSITIONS)
  logoPosition?: (typeof LOGO_POSITIONS)[number];

  @IsOptional()
  @IsIn(PAGE_SIZES)
  pageSize?: (typeof PAGE_SIZES)[number];

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  pathologistName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  pathologistRegNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  labInChargeName?: string;

  @IsOptional()
  @IsBoolean()
  isDigitalSignatureImagePrinted?: boolean;

  @IsOptional()
  @IsBoolean()
  isAutoPublishAfterSecondValidationEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmailPdfOnPublishEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isWhatsappLinkOnPublishEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isReferringDoctorNotifyEnabled?: boolean;

  @IsOptional()
  @IsIn(PDF_WATERMARKS)
  pdfWatermark?: (typeof PDF_WATERMARKS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reportFooterNote?: string;
}
