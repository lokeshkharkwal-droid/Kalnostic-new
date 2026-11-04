import { PaymentEntryType, PaymentMode, PaymentStatus } from '@prisma/client';

/**
 * Patient-facing order progress, derived from the published state of the order's
 * reports. Coarser than the internal per-test `OrderReportStatus` — a patient
 * only needs to know whether their results are ready.
 *  - `READY` — every report on the order is published.
 *  - `PARTIALLY_READY` — some (not all) reports are published.
 *  - `IN_PROGRESS` — nothing published yet.
 */
export type PublicOrderStatus = 'IN_PROGRESS' | 'PARTIALLY_READY' | 'READY';

/**
 * One row of the bill's payment/refund history — a single `PaymentDetails`
 * ledger row reshaped for display. `amount` is the money that moved on this row
 * (collected for a `PAYMENT`, returned for a `REFUND`).
 */
export interface PublicTransaction {
  type: PaymentEntryType;
  amount: number;
  paymentMode: PaymentMode;
  /** ISO datetime the money moved (`paymentDate`, falling back to `createdAt`). */
  paymentDate: string | null;
  /** Transaction reference / receipt no. captured at collection, if any. */
  reference: string | null;
}

/**
 * The minimal, safe projection returned by the public order endpoint. Only the
 * fields the public patient page renders are exposed — never the raw order
 * graph. In particular it omits patient contact details (mobile/email/DOB),
 * internal referral/panel data, and any id beyond those already in the (public)
 * URL, so changing URL params can never surface unrelated data.
 */
export interface PublicOrderView {
  patient: {
    name: string;
    /** Human age string, e.g. "45 Years" / "6 Months" (null when unknown). */
    age: string | null;
    /** Title-cased gender, e.g. "Male" (null when not recorded). */
    gender: string | null;
    /** Unique patient id (UHID) shown to the patient. */
    umId: string | null;
    /** Registration photo URL (nullable — the page falls back to initials). */
    photoUrl: string | null;
  };
  order: {
    orderCode: string;
    externalOrderId: string | null;
    /** ISO date (`YYYY-MM-DD`) — the order's business date. */
    orderDate: string;
    /** Free-text order time captured at registration, if any. */
    orderTime: string | null;
    /** Patient-facing report-readiness status. */
    status: PublicOrderStatus;
    doctorName: string | null;
    branchName: string;
    /** One-line lab/branch address (nullable). */
    branchAddress: string | null;
  };
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  billing: {
    /** The bill reference shown to the patient — the order code. */
    billId: string;
    status: PaymentStatus;
    gross: number;
    discount: number;
    net: number;
    paid: number;
    outstanding: number;
    /** Total money returned to the patient across REFUND ledger rows. */
    refunded: number;
  };
  /** The bill's payment + refund history, oldest first. */
  transactions: PublicTransaction[];
  reports: {
    /** Whether any PUBLISHED report exists (gates the Print Report button). */
    hasPublishedReports: boolean;
    publishedCount: number;
  };
  /**
   * Server-resolved action gating (CLAUDE.md: never hardcode these rules in the
   * frontend). Both come from the branch's QR Code Scan Settings + report state.
   */
  actions: {
    /** Bill's payment status is in the branch's `billPrintablePaymentStatuses`. */
    isBillPrintable: boolean;
    /** At least one report is published (and printable). */
    isReportPrintable: boolean;
  };
}
