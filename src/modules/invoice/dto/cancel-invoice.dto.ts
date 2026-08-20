import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/** Cancel an invoice. A reason is mandatory and retained on the audit trail. */
export class CancelInvoiceDto {
  /** Why the invoice is being cancelled (mandatory). */
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  cancelReason: string;
}
