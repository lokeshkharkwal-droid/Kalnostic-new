import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Allowed MIME types for outsource-center document uploads. */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

/**
 * Optional body for `POST outsource-centers/:outsourceCenterId/documents` —
 * the file itself arrives via the multipart `document` field.
 */
export class CreateOutsourceCenterDocumentDto {
  /** Display name override; defaults to the uploaded file's original name. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;
}
