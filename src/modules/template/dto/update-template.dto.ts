import { TriggerEvent } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { HeaderFooterDto } from './blocks/header-footer.dto';
import { AttachmentRuleDto } from './blocks/attachment-rule.dto';
import { ConsentConfigDto } from './blocks/consent-config.dto';
import { WhatsappConfigDto } from './blocks/whatsapp-config.dto';
import { ReportConfigDto } from './blocks/report-config.dto';

/**
 * Partial update for a template. All fields optional. `type` is IMMUTABLE and
 * therefore omitted — changing a template's type would invalidate its stored
 * `config` (mirrors how `code` is never updated). The service uses the existing
 * row's `type` to know which config to rebuild; a type-specific field is gated
 * by class-validator's `@IsOptional` here and only consumed when relevant to
 * that type. When a config-affecting field is supplied, the whole `config` JSON
 * is rebuilt; otherwise it is left unchanged.
 */
export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEnum(TriggerEvent)
  triggerEvent?: TriggerEvent;

  @IsOptional()
  @IsString()
  @Matches(/^v\d+\.\d+$/, { message: 'version must look like v1.0' })
  version?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentConfigDto)
  consent?: ConsentConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => WhatsappConfigDto)
  whatsapp?: WhatsappConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportConfigDto)
  report?: ReportConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => HeaderFooterDto)
  header?: HeaderFooterDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => HeaderFooterDto)
  footerBlock?: HeaderFooterDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AttachmentRuleDto)
  attachment?: AttachmentRuleDto;
}
