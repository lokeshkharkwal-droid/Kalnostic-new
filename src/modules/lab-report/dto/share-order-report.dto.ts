import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MessagingChannel } from '@prisma/client';
import type {
  ShareChannelResult,
  ShareChannelInfo,
} from '../../communication/services/share.service';

// The per-channel result/info shapes now live with the reusable `ShareService`;
// re-exported here so existing lab-report imports keep resolving.
export type { ShareChannelResult, ShareChannelInfo };

/**
 * "Share and Inform": send an order's lab report to the patient over one channel.
 * The template is resolved server-side from the tenant's ACTIVATED
 * `console_lab_report_as_attachment` template for the chosen channel — the popup
 * has no template selector. `toAddress` is the (auto-filled, editable) contact;
 * when omitted the patient's stored email/mobile/whatsappNumber is used.
 */
export class ShareOrderReportDto {
  @IsEnum(MessagingChannel)
  channel!: MessagingChannel;

  @IsOptional()
  @IsString()
  toAddress?: string;
}

/**
 * "Share All" (Order Console): send an order's lab report to the patient over
 * EVERY channel the tenant has activated a `console_lab_report_as_attachment`
 * template for — Email, SMS, WhatsApp and the in-app message (IAM) — in one
 * request. The optional per-channel fields override the auto-filled recipient
 * for that channel (blank = use the patient's stored contact). IAM has no
 * address (it targets the patient in-app). A channel with no activated template
 * is simply skipped, not an error.
 */
export class ShareAllOrderReportDto {
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

/** Result of a "Share All" request — one entry per attempted channel. */
export interface ShareAllResult {
  orderId: string;
  results: ShareChannelResult[];
}

/** Preload payload for the Share and Inform popup (GET .../share-info). */
export interface ShareInfo {
  orderId: string;
  orderCode: string | null;
  patientName: string;
  patientId: string | null;
  channels: ShareChannelInfo[];
}
