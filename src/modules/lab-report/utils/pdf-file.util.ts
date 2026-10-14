/**
 * File-type predicates for Test Entry "File +" uploads, keyed off the file name
 * / URL path (the `LabReportAttachment` row stores no MIME type, so the
 * extension is all we have). Shared so callers can never disagree:
 *   - `buildTestFileAttachmentHtml` (test-file-attachment.util.ts) — picks which
 *     "File +" uploads the `{test_file_attachment}` tag renders, and how (PDF →
 *     `<embed>`, image → `<img>`).
 *   - `CreateLabReportAttachmentDto` — validates that a "File +" upload
 *     (`kind === 'file'`) is a PDF or an image.
 *
 * Kept in its own file (no DTO import) so the DTO can import these without the
 * import cycle that would form via `test-file-attachment.util.ts` (which imports
 * the DTO's `LabReportAttachmentKind` type).
 */

/**
 * The image extensions the "File +" bucket accepts — standard raster images
 * only (SVG is intentionally excluded; reports embed raster images), mirroring
 * the frontend's `PDF_IMAGE_ACCEPT`.
 */
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;

/** The path portion of a URL, with any query/hash stripped. */
function urlPath(fileUrl: string): string {
  return fileUrl.split(/[?#]/)[0] ?? '';
}

/**
 * @param fileName the uploaded file's name (e.g. `histopath-report.pdf`)
 * @param fileUrl  the stored S3 URL (query/hash ignored)
 * @returns true when the name OR the URL path ends in `.pdf` (case-insensitive)
 */
export function isPdfFileName(fileName: string, fileUrl: string): boolean {
  return /\.pdf$/i.test(fileName) || /\.pdf$/i.test(urlPath(fileUrl));
}

/**
 * @param fileName the uploaded file's name (e.g. `blood-smear.png`)
 * @param fileUrl  the stored S3 URL (query/hash ignored)
 * @returns true when the name OR the URL path ends in a supported image
 *   extension (png/jpg/jpeg/webp/gif/svg, case-insensitive)
 */
export function isImageFileName(fileName: string, fileUrl: string): boolean {
  return (
    IMAGE_EXTENSION.test(fileName) || IMAGE_EXTENSION.test(urlPath(fileUrl))
  );
}
