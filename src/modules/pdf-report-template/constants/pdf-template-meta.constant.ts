/**
 * Allowed values and defaults for the `meta` blob of a PDF report template.
 * The meta keys are the frontend JSON contract (snake_case) — kept verbatim
 * from the spec. Defaults are applied by the service when a key is omitted.
 */

/** Page orientation: Portrait / Landscape. */
export const PDF_ORIENTATIONS = ['P', 'L'] as const;
export type PdfOrientation = (typeof PDF_ORIENTATIONS)[number];

/**
 * Supported page sizes. Ported verbatim from the legacy ezhealthtrack project
 * (mPDF `TemplateConstants::$page_size_option`): the full ISO A/B/C series,
 * the `C76` variant, and two custom barcode sizes (`CB1` = 100×25 mm,
 * `CB2` = 50×25 mm). `Letter`/`Legal` are kept from the previous set so
 * templates already saved with them keep working.
 *
 * Chromium (Puppeteer) has no native knowledge of most of these sizes, so we
 * do NOT pass them as `format`; the renderer resolves exact millimetre
 * dimensions from `PDF_PAGE_DIMENSIONS_MM` below. Keep the two lists in sync.
 */
export const PDF_PAGE_SIZES = [
  // A-series
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
  'A8',
  'A9',
  'A10',
  'A11',
  'A12',
  // B-series
  'B0',
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'B7',
  'B8',
  'B9',
  'B10',
  'B11',
  'B12',
  // C-series (+ C76 variant)
  'C0',
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'C11',
  'C12',
  'C76',
  // Custom barcode sizes
  'CB1',
  'CB2',
  // ANSI (kept from previous set)
  'Letter',
  'Legal',
] as const;
export type PdfPageSize = (typeof PDF_PAGE_SIZES)[number];

/**
 * Exact page dimensions in **millimetres** (portrait: width < height) for every
 * `PdfPageSize`. Chromium can't size most of these via `format`, so the PDF
 * renderer sets explicit `width`/`height` from this map (swapping the two for
 * landscape). Values mirror mPDF's page-size table used by the legacy project.
 */
export const PDF_PAGE_DIMENSIONS_MM: Record<
  PdfPageSize,
  { width: number; height: number }
> = {
  // A-series
  A0: { width: 841, height: 1189 },
  A1: { width: 594, height: 841 },
  A2: { width: 420, height: 594 },
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  A6: { width: 105, height: 148 },
  A7: { width: 74, height: 105 },
  A8: { width: 52, height: 74 },
  A9: { width: 37, height: 52 },
  A10: { width: 26, height: 37 },
  A11: { width: 18, height: 26 },
  A12: { width: 13, height: 18 },
  // B-series
  B0: { width: 1000, height: 1414 },
  B1: { width: 707, height: 1000 },
  B2: { width: 500, height: 707 },
  B3: { width: 353, height: 500 },
  B4: { width: 250, height: 353 },
  B5: { width: 176, height: 250 },
  B6: { width: 125, height: 176 },
  B7: { width: 88, height: 125 },
  B8: { width: 62, height: 88 },
  B9: { width: 44, height: 62 },
  B10: { width: 31, height: 44 },
  B11: { width: 22, height: 31 },
  B12: { width: 15, height: 22 },
  // C-series (+ C76 variant)
  C0: { width: 917, height: 1297 },
  C1: { width: 648, height: 917 },
  C2: { width: 458, height: 648 },
  C3: { width: 324, height: 458 },
  C4: { width: 229, height: 324 },
  C5: { width: 162, height: 229 },
  C6: { width: 114, height: 162 },
  C7: { width: 81, height: 114 },
  C8: { width: 57, height: 81 },
  C9: { width: 40, height: 57 },
  C10: { width: 28, height: 40 },
  C11: { width: 20, height: 28 },
  C12: { width: 14, height: 20 },
  C76: { width: 81, height: 162 },
  // Custom barcode sizes
  CB1: { width: 100, height: 25 },
  CB2: { width: 50, height: 25 },
  // ANSI
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

/** Supported default fonts. */
export const PDF_FONTS = [
  'courier',
  'helvetica',
  'times',
  'dejavusans',
  'dejavuserif',
  'timesb',
  'helveticab',
] as const;
export type PdfFont = (typeof PDF_FONTS)[number];

// ── Report layout enums (frontend "Report Layout" section) ───────────────────
// Allowed values for the report-only layout fields carried in `meta`. Kept
// verbatim from the frontend contract so the two sides validate identically.

/** Body column layout. */
export const PDF_BODY_LAYOUTS = [
  'Single Column',
  'Two Column',
  'Grid',
] as const;
export type PdfBodyLayout = (typeof PDF_BODY_LAYOUTS)[number];

/** Logo placement. */
export const PDF_LOGO_POSITIONS = [
  'Top Left',
  'Top Center',
  'Top Right',
  'None',
] as const;
export type PdfLogoPosition = (typeof PDF_LOGO_POSITIONS)[number];

/** Header/footer block content type. */
export const PDF_BLOCK_TYPES = ['Text', 'Image'] as const;
export type PdfBlockType = (typeof PDF_BLOCK_TYPES)[number];

/** Horizontal alignment (blocks + attachment). */
export const PDF_ALIGNMENTS = ['Left', 'Center', 'Right'] as const;
export type PdfAlignment = (typeof PDF_ALIGNMENTS)[number];

/** Attachment media type. */
export const PDF_ATTACHMENT_TYPES = ['Image', 'PDF', 'Both'] as const;
export type PdfAttachmentType = (typeof PDF_ATTACHMENT_TYPES)[number];

/** Attachment position (full frontend union; report uses the last three). */
export const PDF_ATTACHMENT_POSITIONS = [
  'Before Body',
  'Inline',
  'After Body',
  'Before Params',
  'After Params',
  'End of Report',
  'Media Header',
  'Media Footer',
] as const;
export type PdfAttachmentPosition = (typeof PDF_ATTACHMENT_POSITIONS)[number];

/** Attachment size profile. */
export const PDF_SIZE_PROFILES = ['Small', 'Medium', 'Full Width'] as const;
export type PdfSizeProfile = (typeof PDF_SIZE_PROFILES)[number];

/** Attachment display profile (report only). */
export const PDF_DISPLAY_PROFILES = [
  'Full Width',
  'Grid 2 per Row',
  'Grid 3 per Row',
  'Original Size',
] as const;
export type PdfDisplayProfile = (typeof PDF_DISPLAY_PROFILES)[number];

/**
 * String-valued meta defaults (spec "Default" columns). Empty-string defaults
 * are represented as `''`. These drive the string keys of `PdfTemplateMeta`;
 * non-string meta (e.g. the `images` registry) is added in
 * `PDF_TEMPLATE_META_DEFAULTS` below.
 */
const PDF_TEMPLATE_META_STRING_DEFAULTS = {
  // General
  orientation: 'P',
  page_size: 'A4',
  default_font_size: '10',
  default_font: '',
  margin_left: '15',
  margin_right: '10',
  margin_top: '10',
  margin_bottom: '10',
  margin_header: '5',
  margin_footer: '5',
  watermark_text: '',
  /** Uploaded watermark image URL (takes precedence over `watermark_text`). */
  watermark_image: '',
  template_version: '',
  custom_css: '',
  // Header
  header_name: '',
  header_html: '',
  // Body
  body_name: '',
  body_html: '',
  associate_body_image: '',
  // Footer
  footer_name: '',
  footer_html: '',
} as const;

/**
 * Default meta values. Applied by the service, so a persisted template always
 * has a complete, predictable meta shape. Adds the non-string `images` registry
 * (token id → resolved URL) on top of the string defaults.
 */
export const PDF_TEMPLATE_META_DEFAULTS = {
  ...PDF_TEMPLATE_META_STRING_DEFAULTS,
  /** Uploaded-image registry: `{{image:<id>}}` token id → resolved URL. */
  images: {} as Record<string, string>,
};

/**
 * Fully-populated meta shape. The service always persists a complete meta by
 * merging the client's partial `meta` over `PDF_TEMPLATE_META_DEFAULTS`, so
 * readers/renderers can rely on every key. All spec fields are strings except
 * the `images` registry.
 */
export type PdfTemplateMeta = {
  [K in keyof typeof PDF_TEMPLATE_META_STRING_DEFAULTS]: string;
} & {
  /** Uploaded-image registry: `{{image:<id>}}` token id → resolved URL. */
  images: Record<string, string>;
};
