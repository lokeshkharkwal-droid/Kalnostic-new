import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for reverting a single invoice receipt
 * (`POST /invoices/:id/payments/:paymentId/revert`). Only an optional free-text
 * reason — the invoice + receipt are resolved from the path, never the body.
 */
export class RevertInvoicePaymentDto {
  /** Optional free-text reason recorded against the reverted receipt (audit). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
