import { PaymentMode } from '@prisma/client';
import {
  IsBoolean,
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
 * A payment/ledger entry submitted inline with an order. All amounts are rupees,
 * up to 2 decimal places. Wallet/Points/Previous-Dues fields exist per spec but
 * are NOT computed this phase (stored as provided/defaulted). Shared shape used
 * by the order create/update payloads.
 */
export class OrderPaymentDto {
  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  totalAmount?: number;

  /**
   * Order-level discount (rupees, up to 2 decimal places). Accepts a value
   * with more precision than currency allows (e.g. from percentage math) and
   * rounds it to the nearest paisa before persisting.
   */
  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  orderDiscount?: number;

  /**
   * Total discount applied across the order (every per-line item discount plus
   * the order-level `orderDiscount`), rupees up to 2 decimal places. A runtime
   * rollup the frontend computes as `totalAmount - netAmount`; a value with
   * more precision than currency allows is rounded to the nearest paisa.
   * Stored on the first payment row for bill display/reporting — kept separate
   * from `orderDiscount`.
   */
  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  netDiscount?: number;

  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  visitingCharges?: number;

  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  netAmount?: number;

  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  deductFromWallet?: number;

  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  deductFromPoints?: number;

  @IsOptional()
  @IsBoolean()
  hasClearedPreviousDues?: boolean;

  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tdsDeduction?: number;

  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  payableAmount?: number;

  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  paidAmount?: number;

  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
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
