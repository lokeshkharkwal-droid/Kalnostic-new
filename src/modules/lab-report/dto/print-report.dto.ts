import { IsIn, IsOptional, IsUUID } from 'class-validator';

/** Body for `POST /lab-reports/:id/print`. */
export class PrintReportDto {
  /** Which `PdfReportTemplate` to render with. Omit to use the tenant's
   * single active template of `type` (the common case — most tenants only
   * ever have one). Required if a tenant has more than one active template
   * of that type and needs to pick a specific one. */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  /** Whether this report's order item is a single test or a panel — resolves
   * the tenant's default template against the matching `PdfReportTemplate`
   * type (`lab_report` vs `lab_panel`) when `templateId` is omitted. Defaults
   * to `lab_report`. */
  @IsOptional()
  @IsIn(['lab_report', 'lab_panel'])
  type?: 'lab_report' | 'lab_panel';
}
