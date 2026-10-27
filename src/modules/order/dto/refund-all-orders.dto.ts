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
 * One sub-order's refund allocation in a combined refund-all. `orderId` is the
 * CHILD sub-order; `amount` (rupees, up to 2 decimal places) is returned to the
 * patient — may be 0 to skip that sub-order. `refundCharge` (default 0) is a fee
 * the lab retains. `amount + refundCharge` is validated server-side against the
 * sub-order's actual refundable balance and its branch's partial-refund settings.
 */
export class RefundAllAllocationDto {
  /** The CHILD sub-order id this refund is recorded against. */
  @IsUUID()
  orderId!: string;

  /** Amount (rupees, up to 2 decimal places) refunded to the patient. */
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  /** Fee (rupees, up to 2 decimal places) retained on this refund. Defaults to 0. */
  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  refundCharge?: number;
}

/**
 * Body for `POST /orders/:id/refund-all` — refund across a parent order's CHILD
 * sub-orders, written atomically. Each `allocations[]` entry is validated per
 * sub-order against that sub-order's refundable balance and its branch's
 * `Allow Refund` / `Allow Partial Refund` / `Refund Charges Applicable` settings.
 * At least one allocation must have a positive `amount`. `:id` may be the parent
 * or either child.
 */
export class RefundAllOrdersDto {
  /** Per-sub-order refund amounts (and optional retained charges). */
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RefundAllAllocationDto)
  allocations!: RefundAllAllocationDto[];

  /** How the refunds are paid back (applied to every sub-order refund row). */
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
