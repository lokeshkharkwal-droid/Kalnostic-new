import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

/**
 * Appends uploaded attachments to the END of a finished PDF report, as extra
 * pages — the mechanism behind the `{test_file_attachment_without_header}` print
 * tag.
 *
 * ## Why this exists (and how it differs from `pdf-embed.util.ts`)
 * The `{test_file_attachment}` tag draws a File+ upload INSIDE the report where
 * the tag sits (a PDF via `<embed>` → {@link overlayEmbeddedPdfs}, an image via
 * `<img>`). `{test_file_attachment_without_header}` instead extends the report:
 * the upload's own pages are added AFTER the last report page, untouched by the
 * template's header/footer. So a 5-page report plus a 3-page PDF attachment
 * produces 8 pages, and an image becomes one appended page.
 *
 * The tag renders only a hidden marker in the body (see
 * {@link APPEND_MARKER_CLASS}); `PdfService` reads the markers after layout,
 * prints the report, resolves each marker to a PDF to merge — a PDF upload as-is,
 * an image **rendered to a one-page PDF through the same Chromium the body uses**
 * (so EXIF orientation, CMYK, colour profiles and every image format match the
 * inline tag exactly) — then calls {@link appendPiecesToPdf} on the finished
 * bytes. This module is the pure pdf-lib merge (no browser, no native canvas) so
 * it stays unit-testable; the fetch + Chromium image render stay in `PdfService`.
 */

/**
 * The marker class the append tag emits and `PdfService` scans for. One hidden
 * (`display:none`) `<div>` per attachment, carrying `data-pdf-append-src` (the
 * file URL) and `data-pdf-append-name` (the file name). Kept here as the single
 * source of truth so the builder and the reader can never disagree.
 */
export const APPEND_MARKER_CLASS = 'pdf-append-attachment';

/**
 * One resolved thing to append, in document order:
 *  - `pdf` — bytes to merge page-for-page (a PDF upload, or an image already
 *    rendered to a one-page PDF by `PdfService`);
 *  - `note` — the attachment could not be included (download/render failed), so
 *    a visible placeholder page is drawn in its place instead of silently
 *    dropping it (mirrors the inline tag's "Attached file" fallback).
 */
export type AppendPiece =
  | { type: 'pdf'; name: string; bytes: Uint8Array }
  | { type: 'note'; name: string; reason: string };

/** A4 portrait in PDF points — the page size used when the report has no pages. */
const A4_POINTS: { width: number; height: number } = {
  width: 595.28,
  height: 841.89,
};

/** PNG / JPEG / WebP / GIF file signatures, for choosing a data-URI MIME type. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** True when `bytes` starts with the given byte signature. */
function hasMagic(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) {
    return false;
  }
  return magic.every((b, i) => bytes[i] === b);
}

/** True for a PNG buffer (by signature). */
export function isPng(bytes: Uint8Array): boolean {
  return hasMagic(bytes, PNG_MAGIC);
}

/** True for a JPEG buffer (by signature). */
export function isJpeg(bytes: Uint8Array): boolean {
  return hasMagic(bytes, JPEG_MAGIC);
}

/** True for a WebP buffer: `RIFF....WEBP`. */
export function isWebp(bytes: Uint8Array): boolean {
  return (
    hasMagic(bytes, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    bytes.length >= 12 &&
    hasMagic(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]) // "WEBP"
  );
}

/** True for a GIF buffer: `GIF87a` / `GIF89a`. */
export function isGif(bytes: Uint8Array): boolean {
  return hasMagic(bytes, [0x47, 0x49, 0x46, 0x38]); // "GIF8"
}

/** The report's representative page size (its first page), or A4 when empty. */
function targetPageSize(doc: PDFDocument): { width: number; height: number } {
  if (doc.getPageCount() === 0) {
    return A4_POINTS;
  }
  const { width, height } = doc.getPage(0).getSize();
  return { width, height };
}

/**
 * The first-page size (PDF points) of a finished report, so `PdfService` can
 * render appended image pages at the same dimensions as the report's pages.
 * @param pdfBytes the report PDF
 */
export async function firstPageSizeOf(
  pdfBytes: Uint8Array,
): Promise<{ width: number; height: number }> {
  return targetPageSize(await PDFDocument.load(pdfBytes));
}

/**
 * Append every page of a source PDF to `doc`, unchanged (vector content and text
 * stay intact; each page keeps its own size). Throws for an unreadable/encrypted
 * PDF so the caller can draw a note page instead.
 */
async function appendPdfPages(
  doc: PDFDocument,
  bytes: Uint8Array,
): Promise<void> {
  const src = await PDFDocument.load(bytes);
  const pages = await doc.copyPages(src, src.getPageIndices());
  for (const page of pages) {
    doc.addPage(page);
  }
}

/** Shorten `text` with an ellipsis until it fits `maxWidth` at `size`. */
function fitText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) {
    return text;
  }
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

/**
 * Draw a visible "attachment could not be included" placeholder page, so a file
 * that failed to download/parse/render is surfaced in the report instead of
 * vanishing silently (parallel to the inline tag's "Attached file" link).
 */
function drawNotePage(
  doc: PDFDocument,
  font: PDFFont,
  pageSize: { width: number; height: number },
  name: string,
  reason: string,
): void {
  const page = doc.addPage([pageSize.width, pageSize.height]);
  const margin = 56;
  const maxWidth = Math.max(1, pageSize.width - margin * 2);
  let y = pageSize.height - margin - 14;
  page.drawText(
    fitText('Attachment could not be included', font, 14, maxWidth),
    {
      x: margin,
      y,
      size: 14,
      font,
      color: rgb(0.55, 0, 0),
    },
  );
  y -= 26;
  page.drawText(fitText(`File: ${name}`, font, 11, maxWidth), {
    x: margin,
    y,
    size: 11,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  if (reason) {
    y -= 18;
    page.drawText(fitText(`Reason: ${reason}`, font, 10, maxWidth), {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }
}

/**
 * Append each resolved piece to the end of a finished report PDF, in order: a
 * `pdf` piece merged page-for-page as-is; a `note` piece (or a `pdf` piece whose
 * bytes can't be parsed — e.g. an encrypted PDF) drawn as a visible placeholder
 * page. Returns the original bytes unchanged when there is nothing to append.
 *
 * Every piece is independent — one failure never fails the whole print, and the
 * report plus all other pieces are still produced.
 * @param reportBytes the finished report PDF
 * @param pieces the resolved attachments to append, in order
 * @param onNote called with `(name, reason)` for each piece that becomes a note page
 * @returns the report with the pieces appended
 */
export async function appendPiecesToPdf(
  reportBytes: Uint8Array,
  pieces: AppendPiece[],
  onNote?: (name: string, reason: string) => void,
): Promise<Uint8Array> {
  if (pieces.length === 0) {
    return reportBytes;
  }
  const doc = await PDFDocument.load(reportBytes);
  const pageSize = targetPageSize(doc);
  // The note-page font is embedded once, and only if a note is actually drawn.
  let font: PDFFont | null = null;
  const note = async (name: string, reason: string): Promise<void> => {
    onNote?.(name, reason);
    font ??= await doc.embedFont(StandardFonts.Helvetica);
    drawNotePage(doc, font, pageSize, name, reason);
  };
  for (const piece of pieces) {
    if (piece.type === 'note') {
      await note(piece.name, piece.reason);
      continue;
    }
    try {
      await appendPdfPages(doc, piece.bytes);
    } catch {
      await note(piece.name, 'file could not be read');
    }
  }
  return doc.save();
}
