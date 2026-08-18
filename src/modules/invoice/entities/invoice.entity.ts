import { Prisma } from '@prisma/client';

/** Detail include: an invoice with its source-order links and payment history. */
export const INVOICE_DETAIL_INCLUDE = {
  sourceOrders: {
    where: { deletedAt: null },
    select: {
      id: true,
      orderId: true,
      invoicedAmount: true,
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
      paymentFor: true,
      amount: true,
      paymentMode: true,
      reference: true,
      attachmentUrl: true,
      paymentDate: true,
      notes: true,
      createdBy: true,
      createdAt: true,
    },
  },
} satisfies Prisma.InvoiceInclude;

/** List include: an invoice with a lightweight count of its source orders. */
export const INVOICE_LIST_INCLUDE = {
  _count: { select: { sourceOrders: true } },
} satisfies Prisma.InvoiceInclude;

/** An invoice with source-order links and payment history, for the detail view. */
export type InvoiceDetail = Prisma.InvoiceGetPayload<{
  include: typeof INVOICE_DETAIL_INCLUDE;
}>;

/** An invoice list row with its source-order count. */
export type InvoiceListRow = Prisma.InvoiceGetPayload<{
  include: typeof INVOICE_LIST_INCLUDE;
}>;

/** One invoice payment row (payment-history entry). */
export type InvoicePaymentRow = Prisma.InvoicePaymentGetPayload<{
  select: {
    id: true;
    paymentFor: true;
    amount: true;
    paymentMode: true;
    reference: true;
    attachmentUrl: true;
    paymentDate: true;
    notes: true;
    createdBy: true;
    createdAt: true;
  };
}>;

/** A payment-history row enriched with the recording user's display name (the raw
 *  `createdBy` is a Person id; `createdByName` is resolved for the "By" column). */
export type InvoicePaymentHistoryRow = InvoicePaymentRow & {
  createdByName: string | null;
};

/** Aggregate totals for the invoice summary cards (all whole rupees). */
export interface InvoiceSummary {
  grossAmount: number;
  tdsAmount: number;
  netAmount: number;
  paidInvoice: number;
  paidTds: number;
  outstandingInvoice: number;
  outstandingTds: number;
}
