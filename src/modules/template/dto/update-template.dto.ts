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
} from 'class-validator';
import { FEATURE_TYPE_VALUES } from '../constants/feature-types';

/**
 * Partial update for a messaging template. Every field is optional (explicit
 * fields, not `PartialType`, per SKILL.md). `tenantId`/`branchId` are never
 * accepted — scope stays fixed. Only fields present in the body are changed.
 */
export class UpdateTemplateDto {
  @IsOptional()
  @IsEnum(MessagingChannel)
  preference?: MessagingChannel;

  @IsOptional()
  @IsString()
  @IsIn(FEATURE_TYPE_VALUES)
  feature?: string;

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

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  template?: string;

  @IsOptional()
  @IsEnum(WhatsappMessageType)
  templateType?: WhatsappMessageType;

  @IsOptional()
  @IsEnum(WhatsappTemplateCategory)
  templateCategory?: WhatsappTemplateCategory;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'fileName may contain only letters, digits, underscore and hyphen',
  })
  fileName?: string;
}
