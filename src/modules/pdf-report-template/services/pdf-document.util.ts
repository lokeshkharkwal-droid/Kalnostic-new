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

/**
 * A single `{{image:<id>}}` token, with an OPTIONAL sizing suffix after a pipe:
 * `{{image:ID|w=120}}` or `{{image:ID|w=120,h=60}}`. Group 1 is the id (may
 * carry a file extension's dots or a hyphen); group 2 is the raw size options
 * (`w=120,h=60`) or `undefined` when no suffix is present. Backward-compatible —
 * a plain `{{image:ID}}` still matches with an undefined group 2.
 */
export const IMAGE_TOKEN_PATTERN =
  /\{\{image:([a-zA-Z0-9_.-]+)(?:\|([^}]*))?\}\}/g;

/**
 * A size value is a bare number (treated as `px`) or a number with one
 * whitelisted CSS length unit. The whitelist prevents CSS injection through the
 * token (only lengths reach the emitted `style` attribute).
 */
const IMAGE_SIZE_VALUE_RE = /^(\d+(?:\.\d+)?)(px|%|mm|cm|em|rem|pt|in)?$/;

/**
 * Parse the optional size suffix of an `{{image:ID|w=120,h=60}}` token into a
 * safe inline `style` attribute. Accepts `w`/`width` and `h`/`height`; a bare
 * number is treated as pixels, or an explicit whitelisted unit may be given
 * (`px`, `%`, `mm`, `cm`, `em`, `rem`, `pt`, `in`). Setting only a width keeps
 * the natural aspect ratio (height stays `auto`). Unknown keys and values that
 * fail validation are ignored (defence against CSS injection). Pure.
 * @param options the raw text between `|` and `}}` (e.g. `w=120,h=60`), or undefined
 * @returns a `style="..."` attribute with a leading space, or `''` when empty
 */
export function imageSizeStyleAttr(options: string | undefined): string {
  if (!options) {
    return '';
  }
  const declarations: string[] = [];
  for (const part of options.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = part.slice(0, eq).trim().toLowerCase();
    const match = IMAGE_SIZE_VALUE_RE.exec(part.slice(eq + 1).trim());
    if (!match) {
      continue;
    }
    const css = match[2] ? `${match[1]}${match[2]}` : `${match[1]}px`;
    if (key === 'w' || key === 'width') {
      declarations.push(`width:${css}`);
    } else if (key === 'h' || key === 'height') {
      declarations.push(`height:${css}`);
    }
  }
  return declarations.length ? ` style="${declarations.join(';')}"` : '';
}

/**
 * Replace `{{image:ID}}` tokens with an `<img>` for every id RESOLVABLE in
 * `images` (the template's own `meta.images` merged with the tenant-wide
 * `PrintTemplateImage` registry). Ids may include a file extension (dots) or a
 * hyphen, matching the uploaded-image id form (`New_Hedder_-_Copy_5c25c5.png`).
 *
 * An UNRESOLVED token is left untouched — this is what lets the Latte path keep
 * its `{{image:ID}}` → `{$ID}` fallback for image URLs that come from the render
 * CONTEXT rather than an uploaded image (e.g. `report_approved_by_signature`).
 * Without this, the Latte engine rewrites EVERY `{{image:ID}}` to a `{$ID}`
 * variable the context never supplies, so an uploaded header logo (whose id has
 * `-`/`.` and isn't even a valid single Latte variable) renders as an empty
 * `src` and disappears — while the same token works in flat-bodied templates.
 * @param html the fragment to scan
 * @param images id → src map (uploaded/registry, plus any runtime images)
 * @returns the fragment with resolvable image tokens turned into `<img>` tags
 */
export function resolveImageTokens(
  html: string,
  images: Record<string, string>,
): string {
  if (!html) {
    return html;
  }
  return html.replace(
    IMAGE_TOKEN_PATTERN,
    (whole, id: string, size: string | undefined) => {
      const src = images[id];
      return src
        ? `<img src="${escapeAttr(src)}" alt="${id}"${imageSizeStyleAttr(size)} />`
        : whole;
    },
  );
}

/**
 * Context keys whose flat `{key}` tag renders as an IMAGE wherever it stands in
 * text — not only via `{{image:key}}` or `<img src="{key}">`. Their value is an
 * image src (a barcode data URI), so printing it as text is never useful.
 * Resolved against the render's `images` map, so a context that doesn't supply
 * the image (any non-lab-report type) is unaffected:
 *  - `order_id_barcode` — the Order ID (`Order.orderIdBarcode`) barcode.
 *  - `order_id_qr_code` — the Sample ID (`OrderSample.barcode`) barcode
 *    (legacy tag name; it is a barcode, not a QR code).
 * Every other image-valued key (`patient_image`, …) keeps printing its URL.
 */
export const BARE_IMAGE_TAG_KEYS = new Set([
  'order_id_barcode',
  'order_id_qr_code',
]);

/** A flat single-brace `{identifier}` tag (same shape as the flat engine's). */
const BARE_TAG_PATTERN = /\{([a-zA-Z0-9_][a-zA-Z0-9_.]*)\}/g;

/**
 * Replace a bare `{key}` tag of a {@link BARE_IMAGE_TAG_KEYS} key with an
 * `<img>` of `images[key]` when the tag stands in TEXT. A tag inside an HTML tag
 * (`<img src="{order_id_qr_code}" alt="…">` — the nearest `<` before it comes
 * after the nearest `>`) is left alone, so variable interpolation fills the src
 * as before. Lookup is case-insensitive, like flat variables. A key with no
 * image (empty/missing) is left for normal variable interpolation. Runs before
 * either engine interpolates, so `{tag}`, `{{image:tag}}` and
 * `<img src="{tag}">` all render the same image.
 * @param html the fragment to scan
 * @param images id → src map (runtime images merged over the template's)
 * @returns the fragment with text-position image tags turned into `<img>`s
 */
export function resolveBareImageTags(
  html: string,
  images: Record<string, string>,
): string {
  if (!html) {
    return html;
  }
  return html.replace(
    BARE_TAG_PATTERN,
    (whole, key: string, offset: number, src: string) => {
      const id = key.toLowerCase();
      const image = images[id];
      if (!BARE_IMAGE_TAG_KEYS.has(id) || !image) {
        return whole;
      }
      const insideTag =
        src.lastIndexOf('<', offset) > src.lastIndexOf('>', offset);
      return insideTag
        ? whole
        : `<img src="${escapeAttr(image)}" alt="${id}" />`;
    },
  );
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
