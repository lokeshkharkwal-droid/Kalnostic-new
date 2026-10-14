import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { isImageFileName, isPdfFileName } from '../utils/pdf-file.util';

/** The three attachment buckets shown in the Technician Reporting entry modal. */
export const LAB_REPORT_ATTACHMENT_KINDS = [
  'image',
  'document',
  'file',
] as const;
export type LabReportAttachmentKind =
  (typeof LAB_REPORT_ATTACHMENT_KINDS)[number];

/**
 * Class-validator constraint (CLAUDE.md rule #2 — decorators only, no
 * hand-rolled checks): when the attachment is a Test Entry "File +" upload
 * (`kind === 'file'`), its file must be a PDF or an image. Only `kind === 'file'`
 * PDFs and images feed the `{test_file_attachment}` print tag (a PDF as an
 * `<embed>`, an image as an `<img>` — see `buildTestFileAttachmentHtml`), so any
 * other File+ upload would silently never appear in the printed report — this
 * rejects it up front instead. `image` / `document` uploads (incl. the EMI
 * analyzer-histogram flow) are unaffected.
 *
 * Attached to the mandatory `fileName` property so it always runs.
 */
function IsPdfOrImageWhenFileKind(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isPdfOrImageWhenFileKind',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const obj = args.object as {
            kind?: string;
            fileName?: string;
            fileUrl?: string;
          };
          if (obj.kind !== 'file') {
            return true;
          }
          const fileName = obj.fileName ?? '';
          const fileUrl = obj.fileUrl ?? '';
          return (
            isPdfFileName(fileName, fileUrl) ||
            isImageFileName(fileName, fileUrl)
          );
        },
        defaultMessage(): string {
          return 'Only PDF or image files can be attached with the File button';
        },
      },
    });
  };
}

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
  @IsPdfOrImageWhenFileKind()
  fileName: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Server-measured byte size of the file (returned by `POST /uploads/attachment`).
   * Stored on the row and summed to enforce the per-report total-size limit on
   * "File +" uploads. Optional for backward compatibility.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  fileSizeBytes?: number;
}
