import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Create a radiology certificate inside a master data. `tenantId`/`branchId`/
 * `masterDataId` come from context/path, never the body. Mirrors the EzHealthTrack
 * `rad_medical_certificate` fields: a name, a group label and a rich-text (HTML)
 * body. `name` is unique per master data among active rows (validated in the
 * service / enforced by a partial unique index).
 */
export class CreateRadiologyCertificateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  groupName: string;

  /** Rich-text (HTML) certificate body. */
  @IsString()
  @IsOptional()
  content?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
