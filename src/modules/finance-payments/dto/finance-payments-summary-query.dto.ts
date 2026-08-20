import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaymentMode } from '@prisma/client';

/** Payment-type filter values (Direct order payment vs. Invoice receipt). */
export const PAYMENT_LEDGER_TYPES = ['DIRECT', 'INVOICE'] as const;
export type PaymentLedgerTypeFilter = (typeof PAYMENT_LEDGER_TYPES)[number];

/** Ledger status filter values. */
export const PAYMENT_LEDGER_STATUSES = [
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type PaymentLedgerStatusFilter =
  (typeof PAYMENT_LEDGER_STATUSES)[number];

/**
 * Shared filters for the Finance → Payments **summary** (KPI cards) endpoint.
 * The records endpoint extends this with pagination. All fields optional; the
 * tenant is taken from context, never the query. Note: the summary computes the
 * full mode/cancelled/refunded breakdown, so it **ignores** `mode` and `status`
 * (they only apply to the records list).
 */
export class FinancePaymentsSummaryQueryDto {
  /** Restrict to one branch (validated against the caller's tenant). Omit for all branches. */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Inclusive lower bound on the payment transaction date (ISO date/datetime). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on the payment transaction date (ISO date/datetime). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Free-text search over payment id, bill/order id, invoice no, customer name and mobile. */
  @IsOptional()
  @IsString()
  search?: string;

  /** Payment mode (records list only — ignored by the summary). */
  @IsOptional()
  @IsEnum(PaymentMode)
  mode?: PaymentMode;

  /** Direct vs Invoice. */
  @IsOptional()
  @IsIn(PAYMENT_LEDGER_TYPES)
  type?: PaymentLedgerTypeFilter;

  /** Ledger status (records list only — ignored by the summary). */
  @IsOptional()
  @IsIn(PAYMENT_LEDGER_STATUSES)
  status?: PaymentLedgerStatusFilter;

  /** Referral panel id (B2B). */
  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

  /** Referring doctor id. */
  @IsOptional()
  @IsUUID()
  referredByDoctorId?: string;

  /** Internal referral user id. */
  @IsOptional()
  @IsUUID()
  internalReferralId?: string;

  /** External referral user id. */
  @IsOptional()
  @IsUUID()
  externalReferralId?: string;

  /** Actor (`Person.id`) responsible for the transaction. */
  @IsOptional()
  @IsUUID()
  userId?: string;
}
