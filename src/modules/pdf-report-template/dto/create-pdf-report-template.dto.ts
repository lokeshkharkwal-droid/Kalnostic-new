import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DEFAULT_PDF_REPORT_TEMPLATE_TYPE,
  PDF_REPORT_TEMPLATE_TYPES,
} from '../constants/pdf-report-template-types.constant';
import type { PdfReportTemplateType } from '../constants/pdf-report-template-types.constant';
import { PdfTemplateMetaDto } from './pdf-template-meta.dto';

/**
 * Payload to create a PDF report template. `tenantId` is NEVER accepted from the
 * body (CLAUDE.md §4.7 — it comes from the JWT); an optional `branchId` is
 * validated against the caller's tenant in the service. `isActive` is the
 * boolean form of the spec's numeric `status` (frontend maps 1/0 ⇄ true/false).
 */
export class CreatePdfReportTemplateDto {
  /** One of the supported template type keys (default `lab_report`). */
  @IsOptional()
  @IsIn(PDF_REPORT_TEMPLATE_TYPES)
  type?: PdfReportTemplateType = DEFAULT_PDF_REPORT_TEMPLATE_TYPE;

  /** Template name (trimmed, non-empty). */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  /** Active flag (spec `status` 1/0). Default `true`. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Optional branch scope; omit for a tenant-wide template. */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** General/header/body/footer settings. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PdfTemplateMetaDto)
  meta?: PdfTemplateMetaDto;

  /**
   * Block-based Advance PDF document (AdvanceDocument). Stored verbatim as JSON
   * in the `doc` column and rendered by the block designer's server-side
   * renderer. Validated only as an object here — its internal block shape is a
   * discriminated union owned by the frontend (too large for a nested DTO); the
   * renderer tolerates missing/partial fields. Omit for classic HTML templates.
   */
  @IsOptional()
  @IsObject()
  doc?: Record<string, unknown>;
}
