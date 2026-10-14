import { PaymentMode } from '@prisma/client';

/** Whether a ledger row originated from a direct order payment or an invoice receipt. */
export type PaymentLedgerType = 'DIRECT' | 'INVOICE';

/**
 * Display status of a ledger row. Mostly derived from the parent order/invoice;
 * `REVERTED` is the one per-payment state (the row carries `revertedAt`) — a single
 * payment reverted without cancelling its parent order/invoice.
 */
export type PaymentLedgerStatus =
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'REVERTED';

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
  /**
   * The order's ORIGINAL creator for this row — `Order.createdBy` resolved to a
   * display name. Only Direct rows map to a single order, so `orderCreatedById` /
   * `orderCreatedByName` are populated there; an invoice receipt aggregates many
   * orders, so both are null (the FE renders a "—" fallback). Distinct from
   * {@link user}, which is the payment's own actor.
   */
  orderCreatedById: string | null;
  orderCreatedByName: string | null;
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
  /** Human-readable parent order code (Direct rows, e.g. `ORD-00001`); null for
   *  invoice receipts, which have no single parent order. */
  orderCode: string | null;
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
  /** Single payments reverted (distinct from a whole-order/invoice cancel). */
  revertedCount: number;
  revertedAmount: number;
}
