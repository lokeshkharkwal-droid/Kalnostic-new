/**
 * Magic-byte ("file signature") check: verify an uploaded file's actual bytes
 * match its declared MIME type, so a mislabelled file (e.g. an executable
 * renamed `report.pdf`, or a `.png` that isn't really an image) is rejected at
 * upload instead of being trusted on its extension / client-set Content-Type.
 *
 * Conservative by design: it only knows signatures for the binary types it can
 * reliably fingerprint (PDF + the raster images). For any other declared type —
 * Word/Excel (ZIP/OLE containers), CSV / plain text (no signature), SVG (XML
 * text) — it returns `true` (ambiguous → allow), so this never rejects a
 * legitimate file whose type it can't fingerprint. That keeps it safe to run on
 * the shared upload endpoint used by finance/inventory/etc.
 */

/** How far into the file to scan for the PDF header (the spec allows leading junk). */
const PDF_HEADER_WINDOW = 1024;

/** True when `bytes` appear at `offset` in `buffer`. */
function startsWith(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((b, i) => buffer[offset + i] === b);
}

/** PNG's 8-byte signature. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** JPEG start-of-image marker. */
const JPEG = [0xff, 0xd8, 0xff];
/** `GIF8` (covers both GIF87a and GIF89a). */
const GIF = [0x47, 0x49, 0x46, 0x38];
/** `RIFF` container tag (WebP is `RIFF????WEBP`). */
const RIFF = [0x52, 0x49, 0x46, 0x46];
/** `WEBP` form tag, 8 bytes into a RIFF container. */
const WEBP = [0x57, 0x45, 0x42, 0x50];

/** True when the bytes look like a PDF (`%PDF-` within the first 1 KB). */
function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, PDF_HEADER_WINDOW).includes(Buffer.from('%PDF-'));
}

/**
 * Verify a buffer's content is consistent with its declared MIME type.
 * @param buffer the uploaded file's bytes
 * @param mimeType the declared MIME type (client Content-Type)
 * @returns `true` when the bytes match the type's signature, OR when the type
 *   has no known signature to check against (ambiguous → allow); `false` only
 *   when a recognised signature is expected but the bytes don't match it.
 */
export function contentMatchesMime(buffer: Buffer, mimeType: string): boolean {
  switch (mimeType.toLowerCase()) {
    case 'application/pdf':
      return looksLikePdf(buffer);
    case 'image/png':
      return startsWith(buffer, PNG);
    case 'image/jpeg':
    case 'image/jpg':
      return startsWith(buffer, JPEG);
    case 'image/gif':
      return startsWith(buffer, GIF);
    case 'image/webp':
      return startsWith(buffer, RIFF) && startsWith(buffer, WEBP, 8);
    default:
      // No signature known for this type (svg/text/csv/office containers) → allow.
      return true;
  }
}
