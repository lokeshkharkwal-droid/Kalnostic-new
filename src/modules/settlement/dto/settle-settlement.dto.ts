import { SettlementPayoutMode } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

/**
 * Record one payout against an approved settlement (doc §8). The amount must be
 * positive and within the remaining balance (server-enforced). Appends to Payment
 * History and recalculates the cumulative Settled amount + Balance.
 */
export class SettleSettlementDto {
  /** Payout amount (whole rupees). Must be > 0 and ≤ the remaining balance. */
  @IsInt()
  @Min(1)
  amount: number;

  /** Payout mode (Bank Transfer / UPI / Cheque / Cash / Card). */
  @IsEnum(SettlementPayoutMode)
  payoutMode: SettlementPayoutMode;

  /** Transaction ID / payment reference. */
  @IsString()
  @IsNotEmpty()
  reference: string;

  /** Optional URL to a supporting payout document (file upload is deferred). */
  @IsOptional()
  @IsUrl()
  attachmentUrl?: string;

  /** Optional payout date (defaults to now). */
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  /** Optional free-text notes. */
  @IsOptional()
  @IsString()
  notes?: string;
}
