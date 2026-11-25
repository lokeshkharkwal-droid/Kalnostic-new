import type { BillStatus } from '@prisma/client';

/**
 * Patient-facing progress of an order's testing, derived from its test lines —
 * NOT from whether reports are published (the portal says "reports appear once
 * the lab publishes them, whatever the order status"):
 * - `CANCELLED`           the order was cancelled
 * - `PENDING`             no test has reached reporting yet
 * - `IN_PROGRESS`         testing started but no test line is finished
 * - `PARTIALLY_COMPLETE`  some (not all) test lines are finished
 * - `COMPLETE`            every test line is finished (approved or published)
 */
export type PatientLabOrderStatus =
  | 'CANCELLED'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'PARTIALLY_COMPLETE'
  | 'COMPLETE';

/** How much of the order's reporting the lab has published. */
export type PatientLabReportStatus =
  | 'NOT_PUBLISHED'
  | 'PARTIALLY_PUBLISHED'
  | 'PUBLISHED';

/** A patient the session may view: their own record, or a linked family member. */
export interface PatientViewablePatient {
  patientId: string;
  name: string;
  /** `SELF` for the logged-in person's own record, else the family relationship. */
  relationship: string;
  isSelf: boolean;
}

/** One row of the lab-order list. */
export interface PatientLabOrderListItem {
  orderId: string;
  /** What the patient sees as the order number (external id, else order code). */
  orderNo: string;
  orderDate: string;
  patientId: string;
  patientName: string;
  branchName: string | null;
  branchCity: string | null;
  /** Test / panel names on the order. */
  tests: string[];
  status: PatientLabOrderStatus;
  reportStatus: PatientLabReportStatus;
  publishedReportCount: number;
  /** Enables the download action (at least one published report, not cancelled). */
  canDownloadReports: boolean;
  billStatus: BillStatus;
}

/** One test row inside the order detail. */
export interface PatientLabOrderTestRow {
  /** Present only once the report is published (it is what the PDF routes take). */
  reportId: string | null;
  testName: string;
  /** The panel this test belongs to, when it was ordered as part of a panel. */
  groupName: string | null;
  isPublished: boolean;
  publishedAt: string | null;
}

/** The order detail popup. */
export interface PatientLabOrderDetail extends PatientLabOrderListItem {
  orderTime: string | null;
  referringDoctorName: string | null;
  /** Per-tenant bill id (e.g. DIG-001), when one was generated. */
  billNo: string | null;
  testRows: PatientLabOrderTestRow[];
  /** The business's display locale so the client formats times correctly. */
  locale: {
    timeZone: string;
    dateFormat: string;
    timeFormat: string;
  };
}
