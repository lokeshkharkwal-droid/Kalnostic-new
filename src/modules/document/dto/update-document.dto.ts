import { DocumentStatus, DocumentType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Payload to edit a document. Every edit creates a **new preserved version**, so
 * `version` is REQUIRED and must be a new, unique version string for this
 * document. All other fields are optional — omitted fields keep their current
 * value. Fields are declared explicitly (not via `PartialType`) per SKILL.md §4.
 */
export class UpdateDocumentDto {
  /** New version string for this edit (must be unique within the document). */
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  version: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(120)
  documentNumber?: string;

  @IsEnum(DocumentType)
  @IsOptional()
  documentType?: DocumentType;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsUUID()
  @IsOptional()
  authorId?: string;

  @IsUUID()
  @IsOptional()
  approvedById?: string;

  @IsEnum(DocumentStatus)
  @IsOptional()
  status?: DocumentStatus;

  @IsDateString()
  @IsOptional()
  effectiveDate?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @IsDateString()
  @IsOptional()
  reviewDate?: string;

  /** Display name of the attached file; `null` removes it from the new version. */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  fileName?: string | null;

  /**
   * URL of the stored file (from `POST /uploads/attachment`, or an external
   * link); `null` removes the file from the new version.
   */
  @IsUrl()
  @IsOptional()
  @MaxLength(2048)
  fileUrl?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;
}
