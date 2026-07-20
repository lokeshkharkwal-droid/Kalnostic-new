import { PaymentMode } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Create a payment record against an order. `orderId` is validated to belong to
 * the caller's tenant; `tenantId`/`branchId` are taken from the order's context,
 * never the body. All amounts are integer minor units. Wallet/Points/Previous-
 * Dues fields are stored as provided but NOT computed this phase (deferred).
 */
export class CreatePaymentDetailsDto {
  @IsUUID()
  orderId: string;

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
