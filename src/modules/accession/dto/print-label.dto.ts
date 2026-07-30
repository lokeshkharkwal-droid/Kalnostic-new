import { ArrayNotEmpty, IsArray, IsOptional, IsUUID } from 'class-validator';

/** Body for `POST /accession/samples/print-label` — one barcode label. */
export class PrintLabelDto {
  /** The accession sample to print a label for. */
  @IsUUID()
  sampleId: string;

  /**
   * Which `PdfReportTemplate` (`order_label_print` type) to render with. The
   * picker always sends the selected id; omit to fall back to the tenant's single
   * active label template (throws if none or if more than one exists).
   */
  @IsOptional()
  @IsUUID()
  templateId?: string;
}

/** Body for `POST /accession/samples/print-labels` — many barcode labels at once. */
export class PrintLabelsDto {
  /** The accession samples to print labels for (rendered as a repeating section). */
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  ids: string[];

  /**
   * Which `PdfReportTemplate` (`multiple_order_label_print` type) to render with.
   * Omit to fall back to the tenant's single active multi-label template.
   */
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
