import { PaymentMode } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { roundToTwoDecimalPlacesTransform } from '../../../common/utils';

/**
 * One sub-order's explicit payment allocation in a combined pay-all. `orderId` is
 * the CHILD sub-order; `paidAmount` (rupees, up to 2 decimal places) is what to
 * collect against it — may be 0 to skip that sub-order. Validated server-side
 * against the sub-order's actual pending balance.
 */
export class PayAllAllocationDto {
  /** The CHILD sub-order id this amount is collected against. */
  @IsUUID()
  orderId!: string;

  /** Amount (rupees, up to 2 decimal places) collected against this sub-order. */
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  paidAmount!: number;
}

/**
 * Body for `POST /orders/:id/payments-all` — a single combined payment spread
 * across a parent order's CHILD sub-orders, written atomically. Supply **exactly
 * one** of:
 * - `totalAmount` — the server auto-distributes it across the sub-orders by the
 *   creation-ratio (each sub-order's section share), capped at each sub-order's
 *   remaining balance (overflow spills to the other sub-order), or
 * - `allocations` — an explicit per-sub-order amount (manual override).
 *
 * `:id` may be the parent or either child. All amounts are rupees (2 dp).
 */
export class PayAllOrdersDto {
  /** Total to auto-distribute across the sub-orders. Omit when sending `allocations`. */
  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  totalAmount?: number;

  /** Explicit per-sub-order amounts. Omit when sending `totalAmount`. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PayAllAllocationDto)
  allocations?: PayAllAllocationDto[];

  /** How the payment is collected (applied to every sub-order row). */
  @IsEnum(PaymentMode)
  paymentMode!: PaymentMode;

  /** Optional payment reference / transaction id. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  /** Optional payment date (ISO). Defaults to now when omitted. */
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  /** Optional note stored on each created payment row. */
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  notes?: string;
}
