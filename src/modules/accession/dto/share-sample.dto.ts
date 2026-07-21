import { IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/** Send channels offered by the Share & Inform modal (PDF §A.10.20). */
export const SHARE_CHANNELS = [
  'SMS_API',
  'SMS_DIRECT',
  'WA_API',
  'WA_DIRECT',
  'EMAIL_API',
  'EMAIL_DIRECT',
] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/** "Inform To" recipient targets (PDF §A.10.20). */
export const INFORM_TARGETS = [
  'PATIENT',
  'REFERRED_BY',
  'REFERRAL_PANEL',
  'EMPLOYER',
  'INSURANCE',
  'GUARDIAN',
] as const;
export type InformTarget = (typeof INFORM_TARGETS)[number];

/**
 * Share & Inform payload (PDF §A.10.20) — record a notification/document share
 * against a sample. Available at any status; no status change. The share intent is
 * logged to the sample's history; actual SMS/WhatsApp/Email dispatch is handled by
 * the messaging/Finance module (out of scope here).
 */
export class ShareSampleDto {
  /** Delivery channel (SMS/WhatsApp/Email × API/Direct). */
  @IsIn(SHARE_CHANNELS)
  channel: ShareChannel;

  /** Recipient target (Patient, Referred By, Referral Panel, …). */
  @IsIn(INFORM_TARGETS)
  informTo: InformTarget;

  /** Rendered message content (with placeholders already resolved). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  /** Explicit recipient (mobile / WhatsApp number / email), when overriding. */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  recipient?: string;

  /** URL of a document being shared (Tab 1: Share Document). URL only. */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  documentUrl?: string;
}
