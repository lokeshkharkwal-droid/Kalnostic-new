import { IsIn, IsOptional, IsUUID } from 'class-validator';

/**
 * The order-scoped PDF template `type`s that `POST /orders/:id/print` can render.
 * A subset of `PDF_REPORT_TEMPLATE_TYPES` — the document types whose data comes
 * from a single order (its items, patient, referral, payment ledger). Kept as a
 * local literal (not the full type union) so the endpoint only accepts the four
 * order documents; lab reports/labels have their own endpoints.
 */
export const ORDER_PRINT_TYPES = [
  'order_print',
  'bill_print',
  'trf_print',
  'lab_quotation_print',
] as const;

/** Union of the order-scoped print type keys. */
export type OrderPrintType = (typeof ORDER_PRINT_TYPES)[number];

/** Body for `POST /orders/:id/print`. */
export class PrintOrderDto {
  /**
   * Which order document to render: `order_print` (the order slip),
   * `bill_print` (the patient bill), `trf_print` (Test Requisition Form), or
   * `lab_quotation_print` (the quotation).
   */
  @IsIn(ORDER_PRINT_TYPES)
  type: OrderPrintType;

  /**
   * Which `PdfReportTemplate` to render with. The frontend picker always sends
   * the selected template id. Omit to fall back to the tenant's single active
   * template of `type` (throws if none or if more than one exists).
   */
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
