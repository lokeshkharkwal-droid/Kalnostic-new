import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  PDF_ALIGNMENTS,
  PDF_ATTACHMENT_POSITIONS,
  PDF_ATTACHMENT_TYPES,
  PDF_BLOCK_TYPES,
  PDF_BODY_LAYOUTS,
  PDF_DISPLAY_PROFILES,
  PDF_FONTS,
  PDF_LOGO_POSITIONS,
  PDF_ORIENTATIONS,
  PDF_PAGE_SIZES,
  PDF_SIZE_PROFILES,
} from '../constants/pdf-template-meta.constant';
import type {
  PdfAlignment,
  PdfAttachmentPosition,
  PdfAttachmentType,
  PdfBlockType,
  PdfBodyLayout,
  PdfDisplayProfile,
  PdfFont,
  PdfLogoPosition,
  PdfOrientation,
  PdfPageSize,
  PdfSizeProfile,
} from '../constants/pdf-template-meta.constant';

/** Upper bound for large free-text HTML/CSS fields (chars). */
const HTML_MAX = 100_000;

/** References to a tenant's existing lab-test rendering settings. */
export class ReportRefsDto {
  /** Image-setting reference id (e.g. `IMG-1`). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  image_setting_id?: string;

  /** PDF-setting reference id (e.g. `PDF-1`). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  pdf_setting_id?: string;

  /** Group-layout reference id (e.g. `GL-1`). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  group_layout_id?: string;

  /** Icon-setting reference id (e.g. `IC-1`). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon_setting_id?: string;
}

/** A structured header/footer block (text or image, with alignment). */
export class ReportBlockDto {
  /** Whether the block is rendered. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Block content type: `Text` or `Image`. */
  @IsOptional()
  @IsIn(PDF_BLOCK_TYPES)
  type?: PdfBlockType;

  /** Text content (when `type` is `Text`). */
  @IsOptional()
  @IsString()
  @MaxLength(HTML_MAX)
  text?: string;

  /** Uploaded image file name (when `type` is `Image`). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  image_file?: string;

  /** Horizontal alignment. */
  @IsOptional()
  @IsIn(PDF_ALIGNMENTS)
  alignment?: PdfAlignment;
}

/** Attachment rendering rule for a report template. */
export class ReportAttachmentDto {
  /** Whether attachments are rendered. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Attachment media type: `Image`, `PDF`, or `Both`. */
  @IsOptional()
  @IsIn(PDF_ATTACHMENT_TYPES)
  type?: PdfAttachmentType;

  /** Uploaded file names. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  files?: string[];

  /** Where the attachment is placed in the report. */
  @IsOptional()
  @IsIn(PDF_ATTACHMENT_POSITIONS)
  position?: PdfAttachmentPosition;

  /** Horizontal alignment. */
  @IsOptional()
  @IsIn(PDF_ALIGNMENTS)
  alignment?: PdfAlignment;

  /** Size profile. */
  @IsOptional()
  @IsIn(PDF_SIZE_PROFILES)
  size_profile?: PdfSizeProfile;

  /** Grid/display profile (report only). */
  @IsOptional()
  @IsIn(PDF_DISPLAY_PROFILES)
  display_profile?: PdfDisplayProfile;
}

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

  // ── Report layout (frontend "Report Layout" section) ─────────────────────────
  /** Body column layout (`Single Column`, `Two Column`, `Grid`). */
  @IsOptional()
  @IsIn(PDF_BODY_LAYOUTS)
  body_layout?: PdfBodyLayout;

  /** Logo placement (`Top Left`, `Top Center`, `Top Right`, `None`). */
  @IsOptional()
  @IsIn(PDF_LOGO_POSITIONS)
  logo_position?: PdfLogoPosition;

  /** References to the tenant's existing lab-test rendering settings. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReportRefsDto)
  report_refs?: ReportRefsDto;

  /** Structured header block (alternative to raw `header_html`). */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReportBlockDto)
  header_block?: ReportBlockDto;

  /** Structured footer block (alternative to raw `footer_html`). */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReportBlockDto)
  footer_block?: ReportBlockDto;

  /** Attachment rendering rule. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReportAttachmentDto)
  attachment?: ReportAttachmentDto;
}
