import { PatientDocumentCategory } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for `POST /patients/:patientId/documents`. Records a patient document or
 * consent form as a URL reference only — the file itself lives in external
 * object storage (e.g. AWS S3) and is never uploaded to or stored by the API.
 * `tenantId` (JWT), the patient's `branchId`, and `patientId` (route) come from
 * the request context, never the body (CLAUDE.md §4.7).
 */
export class CreatePatientDocumentDto {
  /** Which tab this row belongs to: a general document or a consent form. */
  @IsEnum(PatientDocumentCategory)
  category: PatientDocumentCategory;

  /** Display name of the document (e.g. "Aadhaar copy", "Pre-op consent"). */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  /** Free-text sub-type shown in the tab's dropdown (e.g. "Aadhaar", "IPD Consent"). */
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  type: string;

  /** Date the document was uploaded / the consent was signed (ISO date). */
  @IsDateString()
  documentDate: string;

  /** URL of the stored file (e.g. an AWS S3 link). Only the URL is persisted. */
  @IsUrl()
  @MaxLength(2048)
  documentUrl: string;
}
