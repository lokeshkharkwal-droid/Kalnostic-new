import { Prisma } from '@prisma/client';

/** Detail include: a settlement with its source-payment links and payout history. */
export const SETTLEMENT_DETAIL_INCLUDE = {
  sourcePayments: {
    where: { deletedAt: null },
    select: {
      id: true,
      paymentId: true,
      orderId: true,
      collectedAmount: true,
      grossAmount: true,
      discountAmount: true,
      netAmount: true,
      dueAmount: true,
      payment: {
        select: {
          id: true,
          paymentMode: true,
          reference: true,
          paymentDate: true,
          createdAt: true,
        },
      },
      order: {
        select: {
          id: true,
          orderCode: true,
          billId: true,
          orderDate: true,
          createdAt: true,
        },
      },
    },
  },
  payments: {
    where: { deletedAt: null },
    orderBy: { paymentDate: 'desc' },
    select: {
      id: true,
      amount: true,
      payoutMode: true,
      reference: true,
      attachmentUrl: true,
      paymentDate: true,
      notes: true,
      createdBy: true,
      createdAt: true,
    },
  },
} satisfies Prisma.SettlementInclude;

/** List include: a settlement with a lightweight count of its source payments. */
export const SETTLEMENT_LIST_INCLUDE = {
  _count: { select: { sourcePayments: true } },
} satisfies Prisma.SettlementInclude;

/** A settlement with source-payment links and payout history, for the detail view. */
export type SettlementDetail = Prisma.SettlementGetPayload<{
  include: typeof SETTLEMENT_DETAIL_INCLUDE;
}>;

/** A settlement list row with its source-payment count. */
export type SettlementListRow = Prisma.SettlementGetPayload<{
  include: typeof SETTLEMENT_LIST_INCLUDE;
}>;

/** One settlement payout row (payment-history entry). */
export type SettlementPaymentRow = Prisma.SettlementPaymentGetPayload<{
  select: {
    id: true;
    amount: true;
    payoutMode: true;
    reference: true;
    attachmentUrl: true;
    paymentDate: true;
    notes: true;
    createdBy: true;
    createdAt: true;
  };
}>;

/** A payout-history row enriched with the recording user's display name (the raw
 *  `createdBy` is a Person id; `createdByName` is resolved for the "By" column). */
export type SettlementPaymentHistoryRow = SettlementPaymentRow & {
  createdByName: string | null;
};

/**
 * Aggregate totals for the settlement summary cards (all whole rupees), plus the
 * derived Balance and the Pending-Approval count (doc §5.2).
 */
export interface SettlementSummary {
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  paidAmount: number;
  dueAmount: number;
  approvedAmount: number;
  settledAmount: number;
  balance: number;
  pendingApprovalCount: number;
}
