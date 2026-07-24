import { IsOptional, IsUUID } from 'class-validator';

/** Body for `POST /lab-reports/:id/print`. */
export class PrintReportDto {
  /** Which `PdfReportTemplate` to render with. Omit to use the tenant's
   * single active `lab_report`-type template (the common case — most
   * tenants only ever have one). Required if a tenant has more than one
   * active `lab_report` template and needs to pick a specific one. */
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
