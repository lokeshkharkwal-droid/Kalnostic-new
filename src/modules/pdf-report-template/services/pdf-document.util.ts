import { PdfTemplateMeta } from '../constants/pdf-template-meta.constant';

/**
 * A template resolved into the three inputs Puppeteer needs to place the header
 * and footer in the page's top/bottom margin bands — repeated on EVERY page and
 * pinned to the physical edges (`page.pdf({ displayHeaderFooter })`):
 *  - `bodyHtml` — the full HTML document with ONLY the body content (+ watermark).
 *  - `headerTemplate` / `footerTemplate` — self-contained Puppeteer header/footer
 *    templates (they carry their own `<style>`, since Chromium renders them in an
 *    isolated context that does NOT inherit the body document's CSS).
 *  - `hasHeaderFooter` — whether either band has content (drives
 *    `displayHeaderFooter`; false = a plain body-only PDF).
 */
export interface PreparedPdfHtml {
  bodyHtml: string;
  headerTemplate: string;
  footerTemplate: string;
  hasHeaderFooter: boolean;
}

/**
 * Coerce an `unknown` value to display text without risking `[object Object]`:
 * strings pass through, numbers/booleans/bigints stringify, everything else
 * (objects, arrays, null/undefined) becomes `''`. Used wherever template data —
 * typed `unknown` — is interpolated into HTML.
 */
export function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return '';
}

/** Escape HTML text content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape a value for use inside a double-quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/** Parse a `meta` millimetre string (e.g. `"10"`) to a number, or a fallback. */
function mm(value: string, fallback: number): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Format a millimetre number for CSS, trimming float noise (e.g. `4.999999`).
 */
function mmCss(value: number): string {
  return `${Math.round(value * 1000) / 1000}mm`;
}

/**
 * The four page margins (mm) a template reserves for the body's frame. The
 * top/bottom margins are the MINIMUM header/footer band heights — `PdfService`
 * grows them further at print time to fit taller header/footer content (see the
 * auto-fit in `pdf.service.ts`), so a real letterhead is never crushed. Empty or
 * invalid meta values fall back to the shared defaults.
 */
export function resolvePageMarginsMm(meta: PdfTemplateMeta): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  return {
    top: mm(meta.margin_top, 10),
    right: mm(meta.margin_right, 10),
    bottom: mm(meta.margin_bottom, 10),
    left: mm(meta.margin_left, 15),
  };
}

/**
 * CSS that keeps arbitrary header/footer HTML inside the page width without
 * distorting it, regardless of the selected page size/orientation:
 *  - images scale DOWN to the available width but keep their natural aspect ratio
 *    and height (`height: auto`) so a real letterhead is never crushed — the page
 *    margin is grown at print time to make room (see `PdfService` auto-fit);
 *  - tables use a fixed layout capped at the content width so wide tables can't
 *    push past the page margins;
 *  - long words/URLs wrap instead of forcing horizontal overflow.
 */
function edgeContentCss(cls: 'pdf-header' | 'pdf-footer'): string {
  return `
      .${cls} img { max-width: 100%; height: auto; }
      .${cls} table { table-layout: fixed; width: 100%; max-width: 100%; border-collapse: collapse; }
      .${cls} td, .${cls} th { overflow: hidden; word-break: break-word; overflow-wrap: break-word; }
      .${cls} * { max-width: 100%; overflow-wrap: break-word; word-wrap: break-word; }`;
}

/**
 * Build one Puppeteer header/footer template string. It is self-contained (own
 * `<style>`, explicit font size, `print-color-adjust: exact` so backgrounds
 * render) — Chromium renders header/footer templates in an isolated context that
 * inherits none of the body's CSS.
 *
 * The template is a plain NATURAL-HEIGHT flow box (no fixed height, no clipping).
 * Chromium natively TOP-aligns the header template to the page's top edge and
 * BOTTOM-aligns the footer template to the bottom edge, then repeats both on
 * every page — so no absolute positioning is needed. The mPDF
 * `margin_header` / `margin_footer` gap becomes padding on the PAGE-EDGE side
 * (top for the header, bottom for the footer); the body-facing side is kept clear
 * because `PdfService` grows the top/bottom page margin to fit the measured
 * header/footer height (the Puppeteer equivalent of mPDF's `setAutoTopMargin`).
 * `mLeft` / `mRight` inset the content to line up with the body's side margins.
 * An empty fragment yields an empty band (suppresses Chromium's default date /
 * page-number chrome).
 */
function buildEdgeTemplate(
  cls: 'pdf-header' | 'pdf-footer',
  fragment: string,
  baseCss: string,
  customCss: string,
  fontFamily: string,
  fontSize: string,
  mLeft: number,
  mRight: number,
  gapMm: number,
): string {
  const isHeader = cls === 'pdf-header';
  const gap = mmCss(gapMm);
  // Gap padding on the page-edge side only; the body-facing side is handled by
  // the auto-fit margin so header/footer content never touches the body.
  const padding = isHeader
    ? `${gap} ${mmCss(mRight)} 0 ${mmCss(mLeft)}`
    : `0 ${mmCss(mRight)} ${gap} ${mmCss(mLeft)}`;
  return `<style>
${baseCss}
${customCss}
${edgeContentCss(cls)}
</style>
<div class="${cls}" style="box-sizing: border-box; width: 100%; padding: ${padding}; font-family: ${fontFamily}sans-serif; font-size: ${escapeHtml(
    fontSize,
  )}pt; color: #1a1a1a; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${fragment}</div>`;
}

/**
 * Assemble a rendered template's header/body/footer HTML fragments (already
 * interpolated by whichever engine — flat `TemplateRenderService` or the Latte
 * all-reports renderer) into the body document plus the Puppeteer header/footer
 * templates. The header and footer are rendered by Chromium into the page's
 * top/bottom margin bands and REPEAT on every page, pinned to the physical edges
 * — so a short/last page still gets its footer at the bottom. Because Chromium
 * renders those templates in an isolated context (no access to the body's
 * stylesheet, and a near-zero default font size), each template embeds its own
 * `<style>` (base + `custom_css`) and an explicit font size.
 *
 * Shared by both render paths so the page frame, base CSS, watermark and margin
 * handling stay identical regardless of the template engine.
 */
export function buildPdfDocuments(
  meta: PdfTemplateMeta,
  header: string,
  body: string,
  footer: string,
): PreparedPdfHtml {
  const fontFamily = meta.default_font ? `${meta.default_font}, ` : '';
  const fontSize = meta.default_font_size || '10';
  const margins = resolvePageMarginsMm(meta);
  const mLeft = margins.left;
  const mRight = margins.right;
  // The mPDF gap from the page edge to the header/footer content
  // (`margin_header` / `margin_footer`). The header/footer templates are
  // natural-height flow boxes; the page's top/bottom margin is grown at print
  // time to fit them (see `PdfService`), so only the page-edge gap is baked in.
  const headerGap = mm(meta.margin_header, 5);
  const footerGap = mm(meta.margin_footer, 5);
  const customCss = meta.custom_css || '';
  // An uploaded watermark image is applied automatically and takes precedence
  // over the text watermark; fall back to text when no image is set.
  const watermark = meta.watermark_image
    ? `<div class="pdf-watermark-image"><img src="${escapeAttr(
        meta.watermark_image,
      )}" alt="watermark" /></div>`
    : meta.watermark_text
      ? `<div class="pdf-watermark">${escapeHtml(meta.watermark_text)}</div>`
      : '';

  const baseCss = `
      * { box-sizing: border-box; }
      body { font-family: ${fontFamily}sans-serif; font-size: ${escapeHtml(
        fontSize,
      )}pt; color: #1a1a1a; margin: 0; padding: 0; }
      .pdf-watermark { position: fixed; top: 45%; left: 0; right: 0; text-align: center;
        font-size: 72pt; color: rgba(0,0,0,0.08); transform: rotate(-30deg);
        z-index: 0; pointer-events: none; }
      .pdf-watermark-image { position: fixed; inset: 0; display: flex;
        align-items: center; justify-content: center; z-index: 0;
        pointer-events: none; }
      .pdf-watermark-image img { max-width: 60%; max-height: 60%; opacity: 0.12; }
      .pdf-header, .pdf-body, .pdf-footer { position: relative; z-index: 1; }
      .signing-authority { display: inline-block; text-align: center; margin: 0 16px; vertical-align: bottom; }
      .signing-authority .sa-signature { max-height: 48px; display: block; margin: 0 auto 4px; }
      .signing-authority .sa-name { font-weight: bold; }
    `;

  const bodyHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
${baseCss}
${customCss}
</style>
</head>
<body>
${watermark}
<div class="pdf-body">${body}</div>
</body>
</html>`;

  return {
    bodyHtml,
    headerTemplate: buildEdgeTemplate(
      'pdf-header',
      header,
      baseCss,
      customCss,
      fontFamily,
      fontSize,
      mLeft,
      mRight,
      headerGap,
    ),
    footerTemplate: buildEdgeTemplate(
      'pdf-footer',
      footer,
      baseCss,
      customCss,
      fontFamily,
      fontSize,
      mLeft,
      mRight,
      footerGap,
    ),
    hasHeaderFooter: header.trim() !== '' || footer.trim() !== '',
  };
}
