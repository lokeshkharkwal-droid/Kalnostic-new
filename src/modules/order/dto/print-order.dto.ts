import { IsIn, IsOptional, IsUUID } from 'class-validator';

/**
 * The order-scoped PDF template `type`s that `POST /orders/:id/print` can render.
 * A subset of `PDF_REPORT_TEMPLATE_TYPES` — the document types whose data comes
 * from a single order (its items, patient, referral, payment ledger). Kept as a
 * local literal (not the full type union) so the endpoint only accepts these
 * order documents; lab reports and per-accession-sample labels have their own
 * endpoints. `order_barcode_print` renders a barcode for the ORDER's own
 * identifier (`orderCode`) — distinct from `order_label_print`, which is the
 * per-`AccessionSample` specimen barcode printed via
 * `POST /accession/samples/print-label(s)`.
 */
export const ORDER_PRINT_TYPES = [
  'order_print',
  'bill_print',
  'trf_print',
  'lab_quotation_print',
  'order_barcode_print',
] as const;

/** Union of the order-scoped print type keys. */
export type OrderPrintType = (typeof ORDER_PRINT_TYPES)[number];

/** Body for `POST /orders/:id/print`. */
export class PrintOrderDto {
  /**
   * Which order document to render: `order_print` (the order slip),
   * `bill_print` (the patient bill), `trf_print` (Test Requisition Form),
   * `lab_quotation_print` (the quotation), or `order_barcode_print` (the
   * order's own identifier barcode).
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
