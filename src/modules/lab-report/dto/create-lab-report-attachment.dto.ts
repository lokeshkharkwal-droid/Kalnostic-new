import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

/** The three attachment buckets shown in the Technician Reporting entry modal. */
export const LAB_REPORT_ATTACHMENT_KINDS = [
  'image',
  'document',
  'file',
] as const;
export type LabReportAttachmentKind =
  (typeof LAB_REPORT_ATTACHMENT_KINDS)[number];

/**
 * Persist an already-uploaded file against a lab report. The file bytes are
 * uploaded first via `POST /uploads/attachment` (S3); this stores only the
 * returned URL + metadata (URL-only, like the generic attachments module).
 */
export class CreateLabReportAttachmentDto {
  @IsIn(LAB_REPORT_ATTACHMENT_KINDS)
  kind: LabReportAttachmentKind;

  @IsUrl()
  @MaxLength(2048)
  fileUrl: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
