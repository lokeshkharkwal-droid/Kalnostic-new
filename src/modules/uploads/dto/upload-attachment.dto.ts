/**
 * Constraints for the generic attachment upload (`POST /uploads/attachment`).
 * The file itself arrives via the multipart `file` field, so there are no body
 * fields to validate here — only the allowed types and size cap the controller's
 * multer `FileInterceptor` enforces.
 */

/** MIME types accepted for a finance attachment (receipt / proof / certificate). */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
] as const;

/** Hard cap for an uploaded attachment: 10 MB. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Shape returned by the upload endpoint — the stored file's public URL. */
export interface UploadAttachmentResult {
  /** Fully-qualified S3 URL of the stored file. */
  url: string;
}
