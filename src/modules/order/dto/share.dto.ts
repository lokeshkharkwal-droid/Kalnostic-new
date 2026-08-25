import { IsIn, IsOptional, IsString } from 'class-validator';
import { MessagingChannel } from '@prisma/client';
import type { ShareChannelResult } from '../../communication/services/share.service';

/**
 * "Share and Inform" for an order document (bill / quotation / appointment
 * confirmation). One generic request/response contract drives every kind — the
 * per-kind feature key, channels, attachment and recipient rules live in
 * `OrderService`'s share-kind registry. The popup has no template selector; the
 * tenant's ACTIVATED messaging template for the kind's feature + channel is used.
 */

/** Who a document is shared with over the deliverable channels. */
export const SHARE_RECIPIENTS = ['PATIENT', 'PANEL'] as const;
export type ShareRecipientType = (typeof SHARE_RECIPIENTS)[number];

/** Deliverable channels a share request may name (a kind restricts these further). */
/**
 * Channels a single-channel share request may name: the deliverable ones
 * (Email/SMS/WhatsApp, routed through the Exchange queue) plus IAM (the in-app
 * notification). A kind restricts these further server-side.
 */
const SHARE_SINGLE_CHANNELS: MessagingChannel[] = [
  MessagingChannel.EMAIL,
  MessagingChannel.SMS,
  MessagingChannel.WHATSAPP,
  MessagingChannel.IAM,
];

/** Body for a single-channel share (`POST /orders/:id/share-{bill,quote,appointment}`). */
export class ShareOrderChannelDto {
  @IsIn(SHARE_SINGLE_CHANNELS)
  channel!: MessagingChannel;

  /** PATIENT (default) or the referral PANEL — ignored by kinds with no panel. */
  @IsOptional()
  @IsIn(SHARE_RECIPIENTS)
  recipientType?: ShareRecipientType;

  /** Auto-filled, editable contact; omit to use the recipient's stored contact. */
  @IsOptional()
  @IsString()
  toAddress?: string;
}

/** Body for a multi-channel "Send All" (`POST /orders/:id/share-{kind}-all`). */
export class ShareOrderAllDto {
  /** The recipient the editable overrides apply to (PATIENT default). */
  @IsOptional()
  @IsIn(SHARE_RECIPIENTS)
  recipientType?: ShareRecipientType;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  sms?: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;
}

/** Default contact block for one share recipient (patient or panel). */
export interface ShareRecipientContacts {
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  /** SMS/mobile number (used by kinds that offer the SMS channel, e.g. appointment). */
  sms: string | null;
}

/** Per-channel activation for a Share popup. */
export interface ShareChannelActivation {
  channel: MessagingChannel;
  activated: boolean;
}

/** Preload payload for a Share popup (GET .../{kind}-share-info). */
export interface ShareOrderInfo {
  orderId: string;
  orderCode: string | null;
  billId: string | null;
  patientName: string;
  /** The kind's deliverable channels + their activation. */
  channels: ShareChannelActivation[];
  /** Whether the tenant has an activated IAM template (drives the In-App chip). */
  iamActivated: boolean;
  /** Default contacts per recipient — `panel` is null when the kind/order has none. */
  recipients: {
    patient: ShareRecipientContacts;
    panel: ShareRecipientContacts | null;
  };
}

/** Result of a "Send All" — one entry per attempted channel (incl. IAM). */
export interface ShareOrderAllResult {
  orderId: string;
  results: ShareChannelResult[];
}
