import { PaymentMode } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * The refund leg of a cancel-with-refund. The `amount` (minor units) is returned
 * to the patient and is capped server-side at `paid − cancellationCharge`.
 */
export class CancelRefundDto {
  /** Amount (minor units) refunded to the patient. */
  @IsInt()
  @Min(1)
  amount!: number;

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

/**
 * Body for `PATCH /orders/:id/cancel`. Cancels the order and, optionally, refunds
 * part of the paid amount. `cancellationCharge` (minor units, default 0) is the
 * fee the lab retains and is deducted from the order's effective paid amount; it
 * must not exceed what was paid. When `refund` is present the order is cancelled
 * **with** a refund (max `paid − cancellationCharge`); otherwise it is cancelled
 * without any refund.
 */
export class CancelOrderDto {
  /** Fee (minor units) retained on cancellation. Defaults to 0. */
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationCharge?: number;

  /** Present ⇒ cancel with refund; absent ⇒ cancel without refund. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CancelRefundDto)
  refund?: CancelRefundDto;
}
