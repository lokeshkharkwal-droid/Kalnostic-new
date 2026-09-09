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
 * Build one Puppeteer header/footer template string. It is self-contained (own
 * `<style>`, explicit font size, `print-color-adjust: exact` so backgrounds
 * render) and padded to line up with the body's left/right margins. An empty
 * fragment yields an empty band (suppresses Chromium's default date/page-number
 * chrome).
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
): string {
  return `<style>
${baseCss}
${customCss}
</style>
<div class="${cls}" style="width: 100%; font-family: ${fontFamily}sans-serif; font-size: ${escapeHtml(
    fontSize,
  )}pt; color: #1a1a1a; padding: 0 ${mRight}mm 0 ${mLeft}mm; -webkit-print-color-adjust: exact; print-color-adjust: exact;">${fragment}</div>`;
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
  const mLeft = mm(meta.margin_left, 12);
  const mRight = mm(meta.margin_right, 12);
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
    ),
    hasHeaderFooter: header.trim() !== '' || footer.trim() !== '',
  };
}
