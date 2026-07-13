/**
 * Allowed values and defaults for the `meta` blob of a PDF report template.
 * The meta keys are the frontend JSON contract (snake_case) — kept verbatim
 * from the spec. Defaults are applied by the service when a key is omitted.
 */

/** Page orientation: Portrait / Landscape. */
export const PDF_ORIENTATIONS = ['P', 'L'] as const;
export type PdfOrientation = (typeof PDF_ORIENTATIONS)[number];

/** Supported page sizes. */
export const PDF_PAGE_SIZES = ['A4', 'A5', 'A3', 'Letter', 'Legal'] as const;
export type PdfPageSize = (typeof PDF_PAGE_SIZES)[number];

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
 * Default meta values (spec "Default" columns). Empty-string defaults are
 * represented as `''`. Applied by the service, so a persisted template always
 * has a complete, predictable meta shape.
 */
export const PDF_TEMPLATE_META_DEFAULTS = {
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
 * Fully-populated meta shape (all keys present as strings). The service always
 * persists a complete meta by merging the client's partial `meta` over
 * `PDF_TEMPLATE_META_DEFAULTS`, so readers/renderers can rely on every key.
 */
export type PdfTemplateMeta = {
  [K in keyof typeof PDF_TEMPLATE_META_DEFAULTS]: string;
};
