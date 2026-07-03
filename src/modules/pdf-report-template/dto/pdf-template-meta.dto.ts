import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PDF_FONTS,
  PDF_ORIENTATIONS,
  PDF_PAGE_SIZES,
} from '../constants/pdf-template-meta.constant';
import type {
  PdfFont,
  PdfOrientation,
  PdfPageSize,
} from '../constants/pdf-template-meta.constant';

/** Upper bound for large free-text HTML/CSS fields (chars). */
const HTML_MAX = 100_000;

/**
 * Validates the `meta` blob of a PDF report template (CLAUDE.md rule #2 —
 * class-validator only). Property names are the exact snake_case keys from the
 * frontend contract; every field is optional (the service applies defaults from
 * `PDF_TEMPLATE_META_DEFAULTS`). Numeric settings are stored as strings, per the
 * spec.
 */
export class PdfTemplateMetaDto {
  // ── General ────────────────────────────────────────────────────────────────
  /** Page orientation: `P` (Portrait) or `L` (Landscape). Default `P`. */
  @IsOptional()
  @IsIn(PDF_ORIENTATIONS)
  orientation?: PdfOrientation;

  /** Page size (`A4`, `A5`, `A3`, `Letter`, `Legal`). Default `A4`. */
  @IsOptional()
  @IsIn(PDF_PAGE_SIZES)
  page_size?: PdfPageSize;

  /** Font size in points, as a string. Default `10`. */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  default_font_size?: string;

  /** Default font (see `PDF_FONTS`). Optional; empty = renderer default. */
  @IsOptional()
  @IsIn(PDF_FONTS)
  default_font?: PdfFont;

  /** Left margin (mm). Default `15`. */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  margin_left?: string;

  /** Right margin (mm). Default `10`. */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  margin_right?: string;

  /** Top margin (mm). Default `10`. */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  margin_top?: string;

  /** Bottom margin (mm). Default `10`. */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  margin_bottom?: string;

  /** Distance from top of page to header (mm). Default `5`. */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  margin_header?: string;

  /** Distance from bottom of page to footer (mm). Default `5`. */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  margin_footer?: string;

  /** Optional watermark text. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  watermark_text?: string;

  /** Version name/tag for the template. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  template_version?: string;

  /** Custom CSS applied to the generated PDF. */
  @IsOptional()
  @IsString()
  @MaxLength(HTML_MAX)
  custom_css?: string;

  // ── Header ─────────────────────────────────────────────────────────────────
  /** Display name for the header section. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  header_name?: string;

  /** HTML content for the header (supports `{var}` and `{{image:ID}}`). */
  @IsOptional()
  @IsString()
  @MaxLength(HTML_MAX)
  header_html?: string;

  // ── Body ───────────────────────────────────────────────────────────────────
  /** Display name for the body section. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  body_name?: string;

  /** HTML content for the report body (supports repeating sections). */
  @IsOptional()
  @IsString()
  @MaxLength(HTML_MAX)
  body_html?: string;

  /** Test name used to associate an image with the report body. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  associate_body_image?: string;

  // ── Footer ─────────────────────────────────────────────────────────────────
  /** Display name for the footer section. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  footer_name?: string;

  /** HTML content for the footer (supports `<signing_authority_tag>` blocks). */
  @IsOptional()
  @IsString()
  @MaxLength(HTML_MAX)
  footer_html?: string;
}
