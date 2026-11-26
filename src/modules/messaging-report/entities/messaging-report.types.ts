/**
 * Types and constants for the Business Admin messaging reports
 * (REPORT → WhatsApp Report / SMS Report). The rows come from the external
 * Exchange gateway, which records every message and the provider's delivery
 * status, exactly as the legacy `subscription/business/whatsAppReport` /
 * `smsReport` screens showed them.
 */

/** Channels with a report screen. Matches the Exchange `context_type`. */
export const MESSAGING_REPORT_CHANNELS = ['whatsapp', 'sms'] as const;
export type MessagingReportChannel = (typeof MESSAGING_REPORT_CHANNELS)[number];

/** WhatsApp delivery statuses the legacy Status filter offered. */
export const WHATSAPP_REPORT_STATUSES = [
  'delivered',
  'failed',
  'pending',
  'read',
  'sent',
] as const;

/**
 * SMS delivery statuses. The legacy filter offered failed/pending/sent; the
 * provider actually reports sent/undelivered/not-sent, so all five are allowed.
 */
export const SMS_REPORT_STATUSES = [
  'sent',
  'undelivered',
  'not-sent',
  'failed',
  'pending',
] as const;

/** Exchange `n_status` codes → label (legacy `Notification::getExchangeNotificationStatusValue`). */
export const NOTIFICATION_STATUS_LABELS: Readonly<Record<string, string>> = {
  '100': 'Pending',
  '200': 'Success',
  '300': 'Retry',
  '400': 'Error',
};

/**
 * Zone of the Exchange's naive `created_at` / `updated_at` strings and of the
 * `period_from` / `period_to` filter. The legacy screens printed them unchanged
 * as Indian local time.
 */
export const EXCHANGE_GATEWAY_TIME_ZONE = 'Asia/Kolkata';

/** Page size the Exchange uses when the response omits `per_page` (legacy screens showed 50). */
export const EXCHANGE_DEFAULT_PER_PAGE = 50;

/** One row of the WhatsApp / SMS report. */
export interface MessagingReportRow {
  /** Exchange notification id (used for the detail call). */
  id: number | null;
  /** Recipient mobile number. */
  to: string | null;
  /** Template / event name (WhatsApp column; null when unknown). */
  template: string | null;
  /** Gateway acceptance: Pending / Success / Retry / Error. */
  notificationStatus: string | null;
  /** Provider delivery status as reported (e.g. Delivered, Read, Undelivered, NOT-SENT). */
  deliveryStatus: string | null;
  /** SMS parts billed for this message (SMS only; null for WhatsApp/unknown). */
  smsParts: number | null;
  /** Created time, ISO-8601 UTC. */
  createdAt: string | null;
  /** Last provider update, ISO-8601 UTC. */
  updatedAt: string | null;
}

/** Paginated report payload (the response interceptor lifts it into `meta`). */
export interface MessagingReportPage {
  data: MessagingReportRow[];
  total: number;
  page: number;
  limit: number;
  /** SMS only: parts summed over the whole filtered set. */
  smsPartsCount?: number | null;
}

/** The "Message Detail" pop-up. */
export interface MessageDetail {
  id: number;
  to: string | null;
  createdAt: string | null;
  message: string | null;
}
