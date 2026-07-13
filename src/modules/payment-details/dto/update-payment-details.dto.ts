import { PaymentMode } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Partial update for a payment record. All fields optional (explicit, per
 * SKILL.md). `orderId` is not editable after creation.
 */
export class UpdatePaymentDetailsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  totalAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderDiscount?: number;

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

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  notes?: string;
}
