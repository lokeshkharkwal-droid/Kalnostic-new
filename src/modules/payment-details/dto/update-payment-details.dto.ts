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
 * Partial update for a payment record. All fields optional (explicit, per
 * SKILL.md). `orderId` is not editable after creation.
 */
export class UpdatePaymentDetailsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  totalAmount?: number;

  /** Order-level discount in minor units; a float is rounded to a whole minor unit. */
  @IsOptional()
  @Transform(roundMinorUnits)
  @IsNumber()
  @Min(0)
  orderDiscount?: number;

  /** Total discount applied to the order (item-level + order-level) in minor units; a float is rounded to a whole minor unit. */
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
