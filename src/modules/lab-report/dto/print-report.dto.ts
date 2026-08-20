import { IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

/** Body for `POST /lab-reports/:id/print` and `POST /lab-reports/order/:orderId/print-all`. */
export class PrintReportDto {
  /** Which `PdfReportTemplate` to render with. Omit to use the tenant's
   * single active template of `type` (the common case — most tenants only
   * ever have one). Required if a tenant has more than one active template
   * of that type and needs to pick a specific one. */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  /**
   * Whether this is a single test report (`lab_report`, default) or a panel
   * report (`lab_panel`). Only used to resolve the tenant's default template
   * when no `templateId` is supplied; the same report record renders either way.
   */
  @IsOptional()
  @IsIn(['lab_report', 'lab_panel'])
  type?: 'lab_report' | 'lab_panel';

  /**
   * `POST .../print-all` only: restrict the consolidated PDF to the reports
   * whose `orderItemId` is in this list, instead of every report on the
   * order. Omit to render the whole order (unchanged default behaviour).
   */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  orderItemIds?: string[];
}
