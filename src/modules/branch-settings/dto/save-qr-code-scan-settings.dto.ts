import { PaymentStatus } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

/**
 * Body of `PUT /branch-settings/qr-code-scan`. Every field is optional so the
 * frontend can patch one part or submit the whole form; a field left out keeps
 * its current value. Tenant and branch come from the token, never from the body.
 */
export class SaveQrCodeScanSettingsDto {
  /**
   * Which bill payment statuses a patient may print from the bill QR code. An
   * empty array means no bill is printable (the UI's "All" is simply all three
   * `PaymentStatus` values). Duplicates are rejected.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(PaymentStatus, { each: true })
  billPrintablePaymentStatuses?: PaymentStatus[];

  /**
   * The Bill Print template id (`pdf_report_templates`, type `bill_print`). Pass
   * `null` to clear the selection; omit to keep it.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  billPrintTemplateId?: string | null;

  /**
   * The Report Print template id (`pdf_report_templates`, type `lab_all_report`).
   * Pass `null` to clear the selection; omit to keep it.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  reportPrintTemplateId?: string | null;
}
