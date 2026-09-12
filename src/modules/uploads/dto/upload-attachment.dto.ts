/**
 * Constraints for the generic attachment upload (`POST /uploads/attachment`).
 * The file arrives via the multipart `file` field. Allowed types + size are
 * enforced by the controller's multer `FileInterceptor`; the stored object keeps
 * the file's original (sanitised) name plus a short unique suffix under a
 * date-partitioned, tenant-scoped key
 * (`{env}/{tenantId}/{YYYY}/{MM}/{DD}/{filename}`).
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

/** Shape returned by the upload endpoint — the stored file's public URL. */
export interface UploadAttachmentResult {
  /** Fully-qualified S3 URL of the stored file. */
  url: string;
}
