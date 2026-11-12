import { OrderStatus } from '@prisma/client';

/**
 * Order statuses that do NOT count as "an order created using a referral" for
 * the referral listings' **Last Order Created Date and Time** column (used by
 * `ReferralUsageService.findLastOrderCreatedAt`).
 *
 * A saved draft is not an order yet, and a quotation is a price quote rather
 * than an order (converting it creates a separate order row, which does count).
 * This mirrors the Billings screen, which also excludes DRAFT and QUOTE.
 * Appointments and cancelled orders still count: they were real orders created
 * with that referral. Soft-deleted orders never count (filtered separately on
 * `deletedAt`).
 */
export const LAST_ORDER_EXCLUDED_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.QUOTE,
];
