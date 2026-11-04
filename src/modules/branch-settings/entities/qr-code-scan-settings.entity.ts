import { PaymentStatus } from '@prisma/client';

/**
 * The branch's QR Code Scan settings: what a patient may open/print after
 * scanning the QR code on their bill or report. Applies to every patient of the
 * branch.
 */
export interface QrCodeScanSettings {
  /**
   * Which bill payment statuses a patient may print from the bill QR code. Empty
   * = no bill is printable. The UI's "All" is simply all three values present.
   */
  billPrintablePaymentStatuses: PaymentStatus[];

  /**
   * The chosen Bill Print template id (`pdf_report_templates`, type `bill_print`),
   * or `null` when none is chosen yet.
   */
  billPrintTemplateId: string | null;

  /**
   * The chosen Report Print template id (`pdf_report_templates`, type
   * `lab_all_report`), or `null` when none is chosen yet.
   */
  reportPrintTemplateId: string | null;
}
