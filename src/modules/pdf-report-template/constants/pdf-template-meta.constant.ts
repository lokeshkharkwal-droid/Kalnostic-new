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
