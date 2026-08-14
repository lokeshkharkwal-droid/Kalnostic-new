import { PaymentMode } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { roundMinorUnits } from '../../../common/utils';

/**
 * A payment/ledger entry submitted inline with an order. All amounts are integer
 * minor units. Wallet/Points/Previous-Dues fields exist per spec but are NOT
 * computed this phase (stored as provided/defaulted). Shared shape used by the
 * order create/update payloads.
 */
export class OrderPaymentDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  totalAmount?: number;

  /**
   * Order-level discount in minor units. Accepts a float (e.g. from percentage
   * math) and is rounded to a whole minor unit before persisting.
   */
  @IsOptional()
  @Transform(roundMinorUnits)
  @IsNumber()
  @Min(0)
  orderDiscount?: number;

  /**
   * Total discount applied across the order (every per-line item discount plus
   * the order-level `orderDiscount`), in minor units. A runtime rollup the
   * frontend computes as `totalAmount - netAmount`; a fractional value is
   * rounded to a whole minor unit. Stored on the first payment row for bill
   * display/reporting — kept separate from `orderDiscount`.
   */
  @IsOptional()
  @Transform(roundMinorUnits)
  @IsNumber()
  @Min(0)
  netDiscount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  visitingCharges?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  netAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  deductFromWallet?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  deductFromPoints?: number;

  @IsOptional()
  @IsBoolean()
  hasClearedPreviousDues?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  tdsDeduction?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  payableAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  paidAmount?: number;

  @IsOptional()
  @IsInt()
  remainingBalance?: number;

  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  /** Payment reference / transaction id for this ledger entry (e.g. UPI ref). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  notes?: string;
}
