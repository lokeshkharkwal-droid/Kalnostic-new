import { PatientDocumentCategory } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for `PATCH /patients/:patientId/documents/:id`. Every field is optional
 * (we deliberately do NOT use `PartialType` — SKILL.md §4). Only the provided
 * fields are applied; `documentUrl`, when sent, is still URL-validated.
 */
export class UpdatePatientDocumentDto {
  /** Which tab this row belongs to: a general document or a consent form. */
  @IsEnum(PatientDocumentCategory)
  @IsOptional()
  category?: PatientDocumentCategory;

  /** Display name of the document. */
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  /** Free-text sub-type shown in the tab's dropdown. */
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  type?: string;

  /** Date the document was uploaded / the consent was signed (ISO date). */
  @IsDateString()
  @IsOptional()
  documentDate?: string;

  /** URL of the stored file (e.g. an AWS S3 link). Only the URL is persisted. */
  @IsUrl()
  @IsOptional()
  @MaxLength(2048)
  documentUrl?: string;
}
