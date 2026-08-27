import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Constraints for the generic attachment upload (`POST /uploads/attachment`).
 * The file arrives via the multipart `file` field; an optional `folder` field
 * namespaces the S3 key. Allowed types + size are enforced by the controller's
 * multer `FileInterceptor`.
 */

/**
 * MIME types accepted for an uploaded attachment. Covers the union needed across
 * the app: documents (pdf), images (jpg/png/webp/gif/svg), office docs, and
 * spreadsheets/csv (QC / inventory / lab evidence).
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
] as const;

/** Hard cap for an uploaded attachment: 10 MB. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Optional multipart body for `POST /uploads/attachment` (the file itself
 * arrives via the `file` field). `folder` namespaces the S3 key per feature.
 */
export class UploadAttachmentDto {
  /**
   * Optional S3 key sub-folder (e.g. "signatures", "patient-documents").
   * Restricted to a safe slug to prevent path traversal / odd keys.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9-_]*$/, {
    message:
      'folder may contain lowercase letters, digits, dash and underscore only',
  })
  folder?: string;
}

/** Shape returned by the upload endpoint — the stored file's public URL. */
export interface UploadAttachmentResult {
  /** Fully-qualified S3 URL of the stored file. */
  url: string;
}
