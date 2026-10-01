import { randomUUID } from 'crypto';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFEmbeddedPage,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFRef,
  PDFString,
  degrees,
  rgb,
} from 'pdf-lib';

/**
 * Helpers for printing `<embed type="application/pdf">` documents inside a
 * Puppeteer-generated PDF.
 *
 * ## Why this exists
 * Chromium's `page.pdf()` never paints the CONTENT of a PDF `<embed>`: the
 * plugin frame prints as an empty dark-grey viewer box. So a template that
 * embeds an uploaded PDF (e.g. the `{test_file_attachment}` tag) would print a
 * grey rectangle instead of the file. `PdfService` works around it in three
 * steps:
 *  1. before printing, each PDF `<embed>` is replaced by one fixed-size "slot"
 *     per source page (sized to that page's aspect ratio, never taller than the
 *     printable area), each overlaid by an invisible marker `<a href>`;
 *  2. Chromium prints as usual and records every link as a PDF Link annotation
 *     carrying the slot's FINAL page and rectangle, after pagination;
 *  3. {@link overlayEmbeddedPdfs} draws the source page into that rectangle
 *     with pdf-lib (vector, text stays selectable) and drops the markers.
 *
 * This module holds the pure pieces: sizing, marker URLs, and the pdf-lib
 * overlay. Network and Puppeteer IO stay in `PdfService`, so everything here is
 * unit-testable without a browser.
 */

/**
 * Fetches a PDF URL and returns its raw bytes, or `null` if it could not be
 * fetched (network error, non-2xx, empty or oversized body). Injected so the
 * pipeline stays testable without real IO.
 */
export type PdfFetcher = (url: string) => Promise<Buffer | null>;

/** A page's displayed size in PDF points, with its `/Rotate` already applied. */
export interface PdfPageSize {
  width: number;
  height: number;
}

/** A fetched, parseable PDF embed source. */
export interface PdfEmbedSource {
  bytes: Uint8Array;
  /** Displayed size of each page that will be printed (capped, see {@link MAX_EMBED_PAGES}). */
  pageSizes: PdfPageSize[];
}

/** Hard cap on printed pages per embedded document, so one huge file can't blow up a report. */
export const MAX_EMBED_PAGES = 50;

/**
 * Fraction of the printable height a slot may use. Keeps a full-height page
 * slot clear of sub-pixel rounding, which would otherwise let Chromium split the
 * slot across two pages.
 */
const SLOT_HEIGHT_SAFETY = 0.97;

/** Host of the marker links. `.invalid` is reserved (RFC 2606), so a marker can never resolve. */
const MARKER_ORIGIN = 'https://kaltros-pdf-embed.invalid/';

/**
 * True when an `<embed>` points at a PDF: an explicit `application/pdf` type, or
 * a URL path ending in `.pdf` (query/hash ignored).
 * @param src the embed's resolved `src`
 * @param type the embed's `type` attribute (may be empty)
 */
export function isPdfEmbed(src: string, type: string): boolean {
  if (type.trim().toLowerCase() === 'application/pdf') {
    return true;
  }
  const path = src.split(/[?#]/)[0] ?? '';
  return /\.pdf$/i.test(path);
}

/**
 * A readable label for a file URL: its last path segment, URL-decoded (falls
 * back to the raw URL when there is none). Used for the "Attached file" link
 * printed when an embed can't be rendered.
 */
export function fileNameFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  const last = path.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last) || url;
  } catch {
    return last || url;
  }
}

/**
 * True when the bytes start like a PDF. The `%PDF-` header may be preceded by a
 * little junk (the spec lets readers scan the first 1 KB), so scan that window.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 1024)).includes('%PDF-');
}

/** The `/Rotate` of a page normalised to 0, 90, 180 or 270. */
function pageRotation(page: PDFPage): number {
  const angle = page.getRotation().angle;
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
}

/**
 * Parse a PDF for embedding: each page's displayed size (width/height swapped
 * for a 90/270 `/Rotate`), capped at {@link MAX_EMBED_PAGES}. Returns `null` for
 * anything that can't be embedded (not a PDF, corrupt, encrypted, no pages), so
 * the caller can fall back instead of failing the whole report.
 * @param bytes the fetched file
 */
export async function readPdfEmbedSource(
  bytes: Uint8Array,
): Promise<PdfEmbedSource | null> {
  if (!looksLikePdf(bytes)) {
    return null;
  }
  try {
    const doc = await PDFDocument.load(bytes);
    const pageSizes = doc
      .getPages()
      .slice(0, MAX_EMBED_PAGES)
      .map((page) => {
        const { width, height } = page.getSize();
        return pageRotation(page) % 180 === 0
          ? { width, height }
          : { width: height, height: width };
      });
    return pageSizes.length > 0 ? { bytes, pageSizes } : null;
  } catch {
    // Encrypted (pdf-lib refuses by default) or malformed: not embeddable.
    return null;
  }
}

/**
 * Size a slot for one source page: the page's aspect ratio, scaled to the
 * printable width but never taller than {@link SLOT_HEIGHT_SAFETY} of the
 * printable height. Whole CSS px, rounded down so it always fits.
 * @param page the source page's displayed size (any unit; only the ratio matters)
 * @param box the printable content box in CSS px
 */
export function fitSlotPx(
  page: PdfPageSize,
  box: { width: number; height: number },
): { width: number; height: number } {
  const maxHeight = box.height * SLOT_HEIGHT_SAFETY;
  const scale = Math.min(box.width / page.width, maxHeight / page.height);
  return {
    width: Math.max(1, Math.floor(page.width * scale)),
    height: Math.max(1, Math.floor(page.height * scale)),
  };
}

/** A fresh per-render marker prefix, so markers from different renders can never collide. */
export function newEmbedMarkerPrefix(): string {
  return `${MARKER_ORIGIN}${randomUUID()}/`;
}

/** The marker link for page `pageIdx` of embed `embedIdx`. */
export function embedMarkerUrl(
  prefix: string,
  embedIdx: number,
  pageIdx: number,
): string {
  return `${prefix}${embedIdx}/${pageIdx}`;
}

/** Parse a marker link back to its embed/page indices, or `null` for any other URI. */
export function parseEmbedMarkerUrl(
  prefix: string,
  uri: string,
): { embedIdx: number; pageIdx: number } | null {
  if (!uri.startsWith(prefix)) {
    return null;
  }
  const match = /^(\d+)\/(\d+)$/.exec(uri.slice(prefix.length));
  if (!match) {
    return null;
  }
  return { embedIdx: Number(match[1]), pageIdx: Number(match[2]) };
}

/** The URI of a Link annotation's URI action, if it has one. */
function annotationUri(annot: PDFDict): string | null {
  const action = annot.lookup(PDFName.of('A'));
  if (!(action instanceof PDFDict)) {
    return null;
  }
  const uri = action.lookup(PDFName.of('URI'));
  return uri instanceof PDFString || uri instanceof PDFHexString
    ? uri.decodeText()
    : null;
}

/** An annotation's `/Rect`, normalised to `[x1, y1, x2, y2]` with x1 < x2 and y1 < y2. */
function annotationRect(
  annot: PDFDict,
): [number, number, number, number] | null {
  const rect = annot.lookup(PDFName.of('Rect'));
  if (!(rect instanceof PDFArray) || rect.size() !== 4) {
    return null;
  }
  const n = rect
    .asArray()
    .map((v) => (v instanceof PDFNumber ? v.asNumber() : Number.NaN));
  if (n.some((v) => !Number.isFinite(v))) {
    return null;
  }
  const [a = 0, b = 0, c = 0, d = 0] = n;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/**
 * Draw an embedded source page into `rect`, fitted and centred, honouring the
 * source page's `/Rotate` (pdf-lib embeds the unrotated page). A white
 * rectangle goes down first to cover the grey plugin box Chromium printed.
 */
function drawIntoRect(
  page: PDFPage,
  embedded: PDFEmbeddedPage,
  rotation: number,
  [x1, y1, x2, y2]: [number, number, number, number],
): void {
  const rw = x2 - x1;
  const rh = y2 - y1;
  page.drawRectangle({
    x: x1,
    y: y1,
    width: rw,
    height: rh,
    color: rgb(1, 1, 1),
  });

  const turned = rotation % 180 !== 0;
  const shownW = turned ? embedded.height : embedded.width;
  const shownH = turned ? embedded.width : embedded.height;
  const scale = Math.min(rw / shownW, rh / shownH);
  const w = embedded.width * scale;
  const h = embedded.height * scale;
  // Bottom-left corner of the fitted, centred box.
  const bx = x1 + (rw - shownW * scale) / 2;
  const by = y1 + (rh - shownH * scale) / 2;
  // pdf-lib rotates counter-clockwise about (x, y); `/Rotate` is clockwise, so
  // rotate by -rotation and move the origin to where the page's own
  // bottom-left corner ends up.
  const origin =
    rotation === 90
      ? { x: bx, y: by + w }
      : rotation === 180
        ? { x: bx + w, y: by + h }
        : rotation === 270
          ? { x: bx + h, y: by }
          : { x: bx, y: by };
  page.drawPage(embedded, {
    ...origin,
    width: w,
    height: h,
    rotate: degrees(-rotation),
  });
}

/**
 * Replace every marker Link annotation (see {@link embedMarkerUrl}) in a
 * Chromium-printed PDF with the matching source page drawn into the
 * annotation's rectangle, then remove the markers. Other annotations (real
 * hyperlinks in the template) are kept. Each source is embedded once however
 * many of its pages are drawn.
 * @param pdf the PDF produced by `page.pdf()`
 * @param sources embed index to parsed source (see {@link readPdfEmbedSource})
 * @param prefix this render's marker prefix (see {@link newEmbedMarkerPrefix})
 * @returns the PDF with the embedded documents drawn in
 */
export async function overlayEmbeddedPdfs(
  pdf: Uint8Array,
  sources: Map<number, PdfEmbedSource>,
  prefix: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const embeddedBySource = new Map<
    number,
    { pages: PDFEmbeddedPage[]; rotations: number[] }
  >();
  const embedSource = async (embedIdx: number) => {
    const cached = embeddedBySource.get(embedIdx);
    if (cached) {
      return cached;
    }
    const source = sources.get(embedIdx);
    if (!source) {
      return null;
    }
    const srcDoc = await PDFDocument.load(source.bytes);
    const indices = source.pageSizes.map((_, i) => i);
    const entry = {
      pages: await doc.embedPdf(srcDoc, indices),
      rotations: indices.map((i) => pageRotation(srcDoc.getPage(i))),
    };
    embeddedBySource.set(embedIdx, entry);
    return entry;
  };

  // A slot is drawn once even if Chromium ever split it into two link rects.
  const drawn = new Set<string>();
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) {
      continue;
    }
    for (let i = annots.size() - 1; i >= 0; i--) {
      const raw: PDFObject | undefined = annots.get(i);
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) {
        continue;
      }
      const uri = annotationUri(annot);
      const marker = uri ? parseEmbedMarkerUrl(prefix, uri) : null;
      if (!marker) {
        continue;
      }
      const key = `${marker.embedIdx}/${marker.pageIdx}`;
      const rect = annotationRect(annot);
      const source = await embedSource(marker.embedIdx);
      const embedded = source?.pages[marker.pageIdx];
      if (rect && source && embedded && !drawn.has(key)) {
        drawIntoRect(
          page,
          embedded,
          source.rotations[marker.pageIdx] ?? 0,
          rect,
        );
        drawn.add(key);
      }
      annots.remove(i);
      if (raw instanceof PDFRef) {
        doc.context.delete(raw);
      }
    }
    if (annots.size() === 0) {
      page.node.delete(PDFName.of('Annots'));
    }
  }
  return doc.save();
}
