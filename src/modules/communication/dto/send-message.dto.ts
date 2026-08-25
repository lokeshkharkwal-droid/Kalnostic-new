import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { MessagingChannel, RecipientType } from '@prisma/client';

/**
 * One resolved recipient of a compose/send request. `toAddress` is the concrete
 * destination (email / E.164 phone / WhatsApp number); `recipientId`/`recipientName`
 * are optional display/trace fields resolved by the frontend.
 */
export class RecipientDto {
  @IsEnum(RecipientType)
  recipientType!: RecipientType;

  @IsOptional()
  @IsString()
  recipientId?: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsString()
  toAddress!: string;
}

/** A base64-encoded attachment forwarded verbatim to the Exchange gateway. */
export class AttachmentDto {
  @IsString()
  data!: string; // base64

  @IsString()
  name!: string;

  @IsString()
  type!: string; // MIME type
}

/**
 * Compose/send a message on one channel to one or more recipients. Either a
 * `templateId`/`feature` (resolved + placeholder-substituted server-side) or a
 * free-text `body` must be supplied — enforced in the service. The active tenant
 * + branch come from the JWT, never from this body (CLAUDE.md §4.7).
 */
export class SendMessageDto {
  @IsEnum(MessagingChannel)
  channel!: MessagingChannel;

  /** Resolve the body from this Template id (takes precedence over `feature`). */
  @IsOptional()
  @IsString()
  templateId?: string;

  /** Resolve the body from the best template for this FEATURE_TYPES key + channel. */
  @IsOptional()
  @IsString()
  feature?: string;

  /** Email subject (ignored for SMS/WhatsApp). */
  @IsOptional()
  @IsString()
  subject?: string;

  /** Free-text body when no template is used, or an override. */
  @IsOptional()
  @IsString()
  body?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  recipients!: RecipientDto[];

  /** Placeholder values ({pn}, {branch_name}, …) substituted into the body. */
  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;

  /** Ordered WhatsApp approved-template params ({{1}},{{2}}…), for WHATSAPP. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateParams?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  /** ISO datetime to defer the send; absent = send ASAP. */
  @IsOptional()
  @IsDateString()
  schedule?: string;

  /** ISO datetime after which an unsent message is dropped (CANCELLED). */
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  /** Campaign/batch tag for later filtering. */
  @IsOptional()
  @IsString()
  campaign?: string;

  /** IANA timezone of the composer (stored for time-of-day windowing). */
  @IsOptional()
  @IsString()
  userTimezone?: string;
}
