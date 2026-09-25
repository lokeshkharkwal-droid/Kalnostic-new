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
 * top/bottom margins double as the header/footer band heights, so the PDF
 * renderer and {@link buildPdfDocuments} MUST derive them the same way — this is
 * the single source of truth. Empty/invalid meta values fall back to the same
 * defaults used when building the edge templates, so the reserved space always
 * matches the wrapper height and content can never bleed across bands.
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
 * Geometry of a header/footer band, in millimetres, derived from the page
 * margins. This is the Puppeteer equivalent of mPDF's margin model:
 *
 *  - `band` — the FULL height Chromium reserves for the edge (the top/bottom page
 *    margin: `margin_top` for the header, `margin_bottom` for the footer). Our
 *    wrapper is sized to exactly this so it fills — and never exceeds — the space
 *    reserved for it, so content can never bleed into the body.
 *  - `gap` — the distance from the physical page edge to the header/footer
 *    content (`margin_header` / `margin_footer`). Applied as padding on the
 *    outer edge so the content sits inside the band exactly where mPDF puts it.
 *  - `content` — the usable content height (`band − gap`); images are capped to
 *    this so they scale down to fit the band instead of overflowing it.
 */
interface EdgeBand {
  band: number;
  gap: number;
  content: number;
}

/**
 * Resolve an edge band from its reserved margin and inner gap, clamping the gap
 * so it can never exceed the reserved margin (which would yield a negative
 * content height for a misconfigured template).
 */
function resolveBand(marginMm: number, gapMm: number): EdgeBand {
  const gap = Math.min(gapMm, marginMm);
  return { band: marginMm, gap, content: Math.max(0, marginMm - gap) };
}

/**
 * CSS that keeps arbitrary header/footer HTML strictly inside its band,
 * regardless of the selected page size/orientation:
 *  - images scale down to the available width AND the band's content height,
 *    keeping their aspect ratio (`object-fit: contain`) — never overflowing;
 *  - tables use a fixed layout capped at the content width so wide tables can't
 *    push past the page margins;
 *  - long words/URLs wrap instead of forcing horizontal overflow.
 * `content` is the band's usable height in mm (see {@link EdgeBand}).
 */
function edgeContentCss(
  cls: 'pdf-header' | 'pdf-footer',
  content: number,
): string {
  const maxH = mmCss(content);
  return `
      .${cls} img { max-width: 100%; max-height: ${maxH}; height: auto; object-fit: contain; }
      .${cls} table { table-layout: fixed; width: 100%; max-width: 100%; border-collapse: collapse; }
      .${cls} td, .${cls} th { overflow: hidden; word-break: break-word; overflow-wrap: break-word; }
      .${cls} * { max-width: 100%; overflow-wrap: break-word; word-wrap: break-word; }`;
}

/**
 * Build one Puppeteer header/footer template string. It is self-contained (own
 * `<style>`, explicit font size, `print-color-adjust: exact` so backgrounds
 * render) and confined to the page's top/bottom margin band so its content can
 * never spill into the body or the opposite edge.
 *
 * Structure is an OUTER wrapper sized to the FULL reserved band height (`band`,
 * in mm) with `overflow: hidden` as the final safety net, containing an INNER
 * content layer that is absolutely anchored to the edge (`top: gap` for the
 * header, `bottom: gap` for the footer) and spans the body's left/right margins.
 * Absolute anchoring (rather than flex) leaves the fragment's own layout — floats,
 * `inline-block`, tables — completely intact, while pinning it where mPDF's
 * `margin_header` / `margin_footer` place it: the header hangs from the top of the
 * band, the footer sits on the bottom, so overflow is clipped away from the body.
 * An empty fragment yields an empty band (suppresses Chromium's default date/
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
  edge: EdgeBand,
): string {
  const isHeader = cls === 'pdf-header';
  // Anchor the content layer to the page edge (top for header, bottom for footer)
  // with the mPDF gap; content taller than the band overflows AWAY from the body
  // and is clipped by the wrapper, so the body-facing edge is always preserved.
  const anchor = isHeader
    ? `top: ${mmCss(edge.gap)};`
    : `bottom: ${mmCss(edge.gap)};`;
  return `<style>
${baseCss}
${customCss}
${edgeContentCss(cls, edge.content)}
</style>
<div class="${cls}" style="box-sizing: border-box; position: relative; width: 100%; height: ${mmCss(
    edge.band,
  )}; overflow: hidden; font-family: ${fontFamily}sans-serif; font-size: ${escapeHtml(
    fontSize,
  )}pt; color: #1a1a1a; -webkit-print-color-adjust: exact; print-color-adjust: exact;"><div class="${cls}-content" style="position: absolute; ${anchor} left: ${mmCss(
    mLeft,
  )}; right: ${mmCss(mRight)};">${fragment}</div></div>`;
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
  // Vertical bands mirror mPDF: `margin_top`/`margin_bottom` are the full space
  // reserved for the header/footer (where the body starts/ends); `margin_header`/
  // `margin_footer` are the gap from the page edge to the header/footer content.
  // The band heights come from the SAME resolver `metaToPdfOptions` uses, so
  // Chromium reserves exactly the space each edge template fills.
  const headerBand = resolveBand(margins.top, mm(meta.margin_header, 5));
  const footerBand = resolveBand(margins.bottom, mm(meta.margin_footer, 5));
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
      headerBand,
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
      footerBand,
    ),
    hasHeaderFooter: header.trim() !== '' || footer.trim() !== '',
  };
}
