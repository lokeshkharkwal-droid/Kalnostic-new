import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

/** Body for `POST /accession/samples/print-label`. */
export class PrintLabelDto {
  @IsUUID()
  sampleId: string;

  /** Which `PdfReportTemplate` to render with. Omit to use the tenant's
   * single active `order_label_print` template. */
  @IsOptional()
  @IsUUID()
  templateId?: string;
}

/** Body for `POST /accession/samples/print-labels`. */
export class PrintLabelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids: string[];

  /** Which `PdfReportTemplate` to render with. Omit to use the tenant's
   * single active `multiple_order_label_print` template. */
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
