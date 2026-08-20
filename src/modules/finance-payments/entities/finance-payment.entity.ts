import { PaymentMode } from '@prisma/client';

/** Whether a ledger row originated from a direct order payment or an invoice receipt. */
export type PaymentLedgerType = 'DIRECT' | 'INVOICE';

/** Display status of a ledger row (derived — no per-payment status column exists). */
export type PaymentLedgerStatus = 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

/**
 * Canonical payment-mode display labels. Mirrors the Finance Collection report
 * mapping in `order/entities/order.entity.ts` (`BillingSummary`): `CARD → Debit
 * Card`, `CREDIT → Credit Card`. Kept in one place so the ledger, the collection
 * report, and the FE all render a mode identically.
 */
export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank Transfer',
  CARD: 'Debit Card',
  CREDIT: 'Credit Card',
  WALLET: 'Wallet',
};

/** Human label for a {@link PaymentMode}. */
export function paymentModeLabel(mode: PaymentMode): string {
  return PAYMENT_MODE_LABELS[mode];
}

/**
 * One unified row of the Finance → Payments ledger, assembled from either a
 * `PaymentDetails` (Direct) or an `InvoicePayment` (Invoice). `paymentId` is the
 * underlying row UUID (no human-readable payment code exists yet); `orderId` /
 * `invoiceId` let the FE target the parent for the Cancel/Edit actions.
 */
export interface PaymentLedgerItem {
  paymentId: string;
  dateTime: string;
  type: PaymentLedgerType;
  billOrInvoiceId: string | null;
  customerName: string;
  mobile: string | null;
  amount: number;
  mode: string;
  modeKey: PaymentMode;
  refId: string | null;
  /** Resolved actor display name (from `Order.createdBy` / `InvoicePayment.createdBy`). */
  user: string | null;
  userId: string | null;
  /** Resolved branch name. */
  branch: string | null;
  branchId: string | null;
  status: PaymentLedgerStatus;
  referralPanel: string | null;
  referredBy: string | null;
  internalReferralUser: string | null;
  externalReferralUser: string | null;
  notes: string | null;
  attachmentUrl: string | null;
  orderId: string | null;
  invoiceId: string | null;
}

/**
 * KPI totals for the Payments summary cards over the active filters. Money in
 * whole rupees. `cancelled`/`refunded` carry both a count and an amount so the FE
 * can show either. Wallet/Privilege/Loyalty are intentionally absent (greyed on
 * the FE for this phase).
 */
export interface FinancePaymentsSummary {
  totalPayments: number;
  cash: number;
  upi: number;
  bankTransfer: number;
  debitCard: number;
  creditCard: number;
  cancelledCount: number;
  cancelledAmount: number;
  refundedCount: number;
  refundedAmount: number;
}
