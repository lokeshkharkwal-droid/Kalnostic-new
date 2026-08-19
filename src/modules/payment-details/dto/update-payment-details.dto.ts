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
 * Partial update for a payment record. All fields optional (explicit, per
 * SKILL.md). `orderId` is not editable after creation.
 */
export class UpdatePaymentDetailsDto {
  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  totalAmount?: number;

  /** Order-level discount (rupees, up to 2 decimal places); a value with more precision (e.g. from percentage math) is rounded to the nearest paisa. */
  @IsOptional()
  @Transform(roundToTwoDecimalPlacesTransform)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  orderDiscount?: number;

  /** Total discount applied to the order (item-level + order-level), rupees up to 2 decimal places; a value with more precision is rounded to the nearest paisa. */
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
