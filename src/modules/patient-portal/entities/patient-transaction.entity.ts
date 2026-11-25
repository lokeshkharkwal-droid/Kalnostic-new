import { BillStatus, TransactionType } from '@prisma/client';

/** Human labels for each transaction type (what the payment was collected for). */
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  APPOINTMENT: 'Appointment',
  ORDER: 'Lab Test / Order',
  BILL: 'Lab Bill',
};

/** One row in the patient transaction list. `paymentStatus`/`source` are
 *  intentionally omitted — those columns are left blank for now. */
export interface PatientTransactionRow {
  /** PaymentDetails id — the unique transaction identifier + detail key. */
  id: string;
  /** ISO — the payment date (falls back to the row's creation time). */
  dateTime: string;
  patientName: string;
  /** Amount collected in this transaction (rupees). */
  totalPayment: number;
  transactionType: TransactionType;
  transactionTypeLabel: string;
  /** The business (tenant) this transaction belongs to — the detail/PDF key for
   *  cross-business aggregation (a patient enrolled in many labs sees them all). */
  tenantId: string;
  /** Display name of that business (lab). */
  tenantName: string;
}

/** The order context shown in the transaction detail modal. */
export interface PatientTransactionOrderInfo {
  patientName: string;
  /** Patient-facing UMID (PAT…); `—` when the patient has none. */
  patientId: string;
  /** ISO appointment date/time from the order — null for non-appointment orders.
   *  NEVER the transaction timestamp. */
  appointmentAt: string | null;
  /** User-facing order code. */
  orderId: string;
  billStatus: BillStatus;
  billStatusLabel: string;
  branchName: string | null;
  /** The business (lab) this order belongs to — shown in the detail modal. */
  tenantName: string | null;
}

/** The payment facts shown in the transaction detail modal. */
export interface PatientTransactionPaymentInfo {
  /** PaymentDetails id (same as the transaction id). */
  transactionId: string;
  /** ISO — actual payment date/time. */
  paidOn: string;
  /** Amount received (rupees). */
  amount: number;
  /** Payment method label (Cash / UPI / Debit Card / …). */
  paidVia: string;
  /** ISO — the order's latest refund date, or null when none. */
  refundDate: string | null;
}

/** The full transaction-detail payload for the modal. */
export interface PatientTransactionDetail {
  id: string;
  /** Amount collected (rupees) — shown in the modal heading. */
  amount: number;
  /** Unique transaction identifier (PaymentDetails id). */
  transactionId: string;
  transactionType: TransactionType;
  transactionTypeLabel: string;
  /** Internal order UUID this payment belongs to — used to download the order's
   *  bill PDF from the modal footer (never shown to the patient). */
  billOrderId: string;
  order: PatientTransactionOrderInfo;
  payment: PatientTransactionPaymentInfo;
}
