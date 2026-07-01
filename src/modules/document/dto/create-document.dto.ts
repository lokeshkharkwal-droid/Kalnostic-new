import { DocumentStatus, DocumentType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Payload to create a controlled document. `tenantId`/`branchId` are NOT
 * accepted — they come from the request context (CLAUDE.md §4.7). Creation seeds
 * version 1 of the document's preserved history.
 */
export class CreateDocumentDto {
  /** Required human-facing document number (unique per branch among active rows). */
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  documentNumber: string;

  @IsEnum(DocumentType)
  documentType: DocumentType;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  /** Initial version string (unique per document). */
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  version: string;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  /** Person id of the author (active staff of the tenant). */
  @IsUUID()
  @IsOptional()
  authorId?: string;

  /** Person id of the approver (active staff of the tenant). */
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

  /** Uploaded file name (upload handled elsewhere; this stores the reference). */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  fileName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  fileUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;
}
