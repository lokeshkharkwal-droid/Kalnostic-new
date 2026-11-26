import { CommunicationLog } from '@prisma/client';

/**
 * The persisted communication log/queue row. Re-exported from the generated
 * Prisma types so controllers/services share one canonical entity shape
 * (the module has no ORM-entity classes — Prisma is the only data layer).
 */
export type CommunicationLogEntity = CommunicationLog;

/**
 * One row of an order's "Past Notifications" list (Share & Inform). A slim
 * projection of {@link CommunicationLog}: the `payload` column (which carries
 * the base64 PDF attachments) is never selected.
 */
export type OrderNotificationView = Pick<
  CommunicationLog,
  | 'id'
  | 'channel'
  | 'status'
  | 'feature'
  | 'recipientType'
  | 'recipientName'
  | 'toAddress'
  | 'subject'
  | 'body'
  | 'statusMessage'
  | 'scheduledAt'
  | 'sentAt'
  | 'createdAt'
> & {
  /** Human label of `feature` (e.g. "Order Bill as Attachment"); null when none. */
  featureLabel: string | null;
  /** True for system-raised event notifications (vs. a user's manual share). */
  isAutomatic: boolean;
};
