import { PaymentMode } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { roundToTwoDecimalPlacesTransform } from '../../../common/utils';

/**
 * Body for `POST /orders/:id/refund` — a standalone "Refund Without
 * Cancellation" (the order keeps its status). All amounts are rupees, up to 2
 * decimal places. `amount` is returned to the patient; `refundCharge` (default
 * 0) is a fee the lab retains out of the refund. Server-side, `amount +
 * refundCharge` is capped at the order's current effective paid amount. Also
 * used to top up a partial refund on an already-cancelled order.
 */
export class RefundOrderDto {
  /** Amount (rupees, up to 2 decimal places) refunded to the patient. */
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  /** Fee (rupees, up to 2 decimal places) retained on the refund. Defaults to 0. */
  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  refundCharge?: number;

  /** How the refund is paid back. */
  @IsEnum(PaymentMode)
  paymentMode!: PaymentMode;

  /** Optional refund reference / transaction id. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  /** Optional refund date (ISO). Defaults to now when omitted. */
  @IsOptional()
  @IsDateString()
  paymentDate?: string;
}
