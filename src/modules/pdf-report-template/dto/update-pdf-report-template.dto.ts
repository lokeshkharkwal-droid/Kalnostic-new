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
import { PDF_REPORT_TEMPLATE_TYPES } from '../constants/pdf-report-template-types.constant';
import type { PdfReportTemplateType } from '../constants/pdf-report-template-types.constant';
import { PdfTemplateMetaDto } from './pdf-template-meta.dto';

/**
 * Partial update for a PDF report template. Every field is optional (mirrors the
 * create DTO — the codebase does not use `PartialType`). When `meta` is
 * supplied it REPLACES the stored meta (defaults re-applied by the service).
 * `tenantId` is never accepted from the body.
 */
export class UpdatePdfReportTemplateDto {
  @IsOptional()
  @IsIn(PDF_REPORT_TEMPLATE_TYPES)
  type?: PdfReportTemplateType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PdfTemplateMetaDto)
  meta?: PdfTemplateMetaDto;

  /**
   * Block-based Advance PDF document (AdvanceDocument). When supplied it
   * REPLACES the stored `doc`. Validated only as an object (see the create DTO).
   */
  @IsOptional()
  @IsObject()
  doc?: Record<string, unknown>;
}
