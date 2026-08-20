import { InvoicePaymentFor, PaymentMode } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

/**
 * Record one receipt against an invoice — toward either the INVOICE balance or the
 * TDS balance. Invoice and TDS receipts are posted as separate calls so mode /
 * reference / audit history stay distinct.
 */
export class ReceiveInvoicePaymentDto {
  /** Which balance this receipt settles. */
  @IsEnum(InvoicePaymentFor)
  paymentFor: InvoicePaymentFor;

  /** Amount received (whole rupees). Must be positive and within the balance. */
  @IsInt()
  @Min(1)
  amount: number;

  /** Payment mode (from the shared payment-mode set). */
  @IsEnum(PaymentMode)
  paymentMode: PaymentMode;

  /** Cheque / UTR / NEFT / card / certificate reference. */
  @IsString()
  @IsNotEmpty()
  reference: string;

  /** Optional URL to a supporting document (receipt / proof / TDS certificate). */
  @IsOptional()
  @IsUrl()
  attachmentUrl?: string;

  /** Optional receipt date (defaults to now). */
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  /** Optional free-text notes. */
  @IsOptional()
  @IsString()
  notes?: string;
}
