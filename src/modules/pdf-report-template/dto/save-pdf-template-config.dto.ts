import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/** One slot → template assignment (a null/absent `templateId` clears the slot). */
export class PdfTemplateConfigAssignmentDto {
  /** A `PDF_REPORT_TEMPLATE_TYPES` key; validated against the slot catalogue. */
  @IsString()
  slotKey!: string;

  /** The chosen PdfReportTemplate id, or null/absent to leave the slot unset. */
  @IsOptional()
  @IsUUID()
  templateId?: string | null;
}

/**
 * Body of `PUT /pdf-report-templates/config` — the full set of slot assignments
 * to upsert for the caller's scope. Only the slots present are touched.
 */
export class SavePdfTemplateConfigDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PdfTemplateConfigAssignmentDto)
  assignments!: PdfTemplateConfigAssignmentDto[];
}
