import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PDF_REPORT_TEMPLATE_TYPES } from '../../pdf-report-template/constants/pdf-report-template-types.constant';
import type { PdfReportTemplateType } from '../../pdf-report-template/constants/pdf-report-template-types.constant';

/** Body for `POST /orders/:id/print`. */
export class PrintOrderDto {
  /** Which `PdfReportTemplate` to render with. Omit to use the tenant's
   * single active template of `type` (the common case — most tenants only
   * ever have one). Required if a tenant has more than one active template
   * of that type and needs to pick a specific one. */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  /** Which document this print action represents — resolves the tenant's
   * default template against the matching `PdfReportTemplate` type
   * (`order_print`, `bill_print`, `lab_quotation_print`, …) when `templateId`
   * is omitted. Defaults to `order_print`. */
  @IsOptional()
  @IsIn(PDF_REPORT_TEMPLATE_TYPES)
  type?: PdfReportTemplateType;
}
