import {
  ApplicableBranchType,
  ApplicationScope,
  MessageType,
  MessagingChannel,
  MessagingLevel,
  SmsType,
  WhatsappMessageType,
  WhatsappTemplateCategory,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { FEATURE_TYPE_VALUES } from '../constants/feature-types';

/**
 * Payload for creating a messaging template. Flat by design — a delivery
 * `preference` (channel) plus a `feature` (business event) and channel-specific
 * settings. `tenantId`/`branchId` are NOT accepted here — they come from the
 * request context (CLAUDE.md §4.7). WhatsApp fields are required only when
 * `preference === WHATSAPP`.
 */
export class CreateTemplateDto {
  // ── Core settings ──

  /** Delivery channel. */
  @IsEnum(MessagingChannel)
  preference: MessagingChannel;

  /** Business event key — must be one of the known FEATURE_TYPES. */
  @IsString()
  @IsIn(FEATURE_TYPE_VALUES)
  feature: string;

  /** Optional human-readable title. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  displayTitle?: string;

  @IsOptional()
  @IsEnum(MessageType)
  messageType?: MessageType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  // ── Scope & targeting ──

  @IsOptional()
  @IsEnum(ApplicationScope)
  specificApplication?: ApplicationScope;

  @IsOptional()
  @IsEnum(ApplicableBranchType)
  applicableBranchType?: ApplicableBranchType;

  @IsOptional()
  @IsEnum(MessagingLevel)
  level?: MessagingLevel;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  entityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(45)
  entityType?: string;

  // ── SMS settings ──

  /** DLT-registered SMS template id. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  smsTemplateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  smsSenderId?: string;

  @IsOptional()
  @IsEnum(SmsType)
  smsType?: SmsType;

  // ── Body ──

  /** Rich HTML when `preference = EMAIL`, otherwise plain text with `{placeholders}`. */
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  template: string;

  // ── WhatsApp settings (required when preference = WHATSAPP) ──

  @ValidateIf(
    (o: CreateTemplateDto) => o.preference === MessagingChannel.WHATSAPP,
  )
  @IsEnum(WhatsappMessageType)
  templateType?: WhatsappMessageType;

  @ValidateIf(
    (o: CreateTemplateDto) => o.preference === MessagingChannel.WHATSAPP,
  )
  @IsEnum(WhatsappTemplateCategory)
  templateCategory?: WhatsappTemplateCategory;

  /** Attachment file name — alphanumeric plus `_` and `-` only. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'fileName may contain only letters, digits, underscore and hyphen',
  })
  fileName?: string;
}
