import { BillStatus } from '@prisma/client';

/** One row in the patient billing list. */
export interface PatientBillRow {
  orderId: string;
  orderCode: string;
  billNumber: string;
  patientName: string;
  /** ISO — order creation (check-in time for a checked-in appointment). */
  orderDate: string;
  branchName: string | null;
  billStatus: BillStatus;
  billStatusLabel: string;
  netAmount: number;
  paidAmount: number;
  balanceAmount: number;
  /** The business (tenant) this bill belongs to — the detail/PDF key for
   *  cross-business aggregation (a patient enrolled in many labs sees them all). */
  tenantId: string;
  /** Display name of that business (lab). */
  tenantName: string;
}

/** One line in the bill's order-items table. */
export interface PatientBillItem {
  type: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

/** One row in the bill's transactions table. */
export interface PatientBillTransaction {
  id: string;
  /** ISO — payment date. */
  paidOn: string;
  method: string;
  notes: string;
  amountPaid: number;
  refundedAmount: number;
}

/** The bill's financial summary (from the authoritative order rollups). */
export interface PatientBillSummary {
  orderAmount: number;
  discount: number;
  netAmount: number;
  totalPaid: number;
  balance: number;
}

/** The full bill-detail payload for the modal. */
export interface PatientBillDetail {
  orderId: string;
  orderCode: string;
  billNumber: string;
  patientName: string;
  orderDate: string;
  branchName: string | null;
  /** The business (lab) this bill belongs to — shown in the detail modal. */
  tenantName: string | null;
  billStatus: BillStatus;
  billStatusLabel: string;
  items: PatientBillItem[];
  transactions: PatientBillTransaction[];
  summary: PatientBillSummary;
}
