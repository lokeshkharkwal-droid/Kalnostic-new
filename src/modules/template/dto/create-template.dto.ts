import { TemplateType, TriggerEvent } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { HeaderFooterDto } from './blocks/header-footer.dto';
import { AttachmentRuleDto } from './blocks/attachment-rule.dto';
import { ConsentConfigDto } from './blocks/consent-config.dto';
import { WhatsappConfigDto } from './blocks/whatsapp-config.dto';
import { ReportConfigDto } from './blocks/report-config.dto';

/**
 * Create payload for a template. Type-specific fields are gated by `type` with
 * `@ValidateIf` (the CreateCategoryDto pattern), so e.g. `whatsapp` is only
 * validated/accepted for a WHATSAPP template. The service assembles the JSON
 * columns (`config`, `headerBlock`, `footerBlock`, `attachment`) from these
 * fields.
 *
 * NOTE: `code` is NOT accepted from the client — it is system-generated
 * (`{INITIALS}-Tpl-{n}`, per-tenant sequential) and immutable. `tenantId` /
 * `branchId` likewise come from the request context, never the body (§4.7).
 */
export class CreateTemplateDto {
  @IsEnum(TemplateType)
  type: TemplateType;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsEnum(TriggerEvent)
  triggerEvent: TriggerEvent;

  /** Editable version label, e.g. `v1.0`. Defaults to `v1.0` in the service. */
  @IsOptional()
  @IsString()
  @Matches(/^v\d+\.\d+$/, { message: 'version must look like v1.0' })
  version?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Message body — required for every type except REPORT_TEMPLATE. */
  @ValidateIf((o: CreateTemplateDto) => o.type !== TemplateType.REPORT_TEMPLATE)
  @IsString()
  @MaxLength(20000)
  body: string;

  // ── Type-specific (gated by `type`) ──────────────────────────────────────────

  /** EMAIL only — subject line. Stored as `config.subject`. */
  @ValidateIf((o: CreateTemplateDto) => o.type === TemplateType.EMAIL)
  @IsString()
  @MaxLength(500)
  subject?: string;

  /** CONSENT_FORM only — stored as `config` (`{ signatureRequired, consent }`). */
  @ValidateIf((o: CreateTemplateDto) => o.type === TemplateType.CONSENT_FORM)
  @ValidateNested()
  @Type(() => ConsentConfigDto)
  consent?: ConsentConfigDto;

  /** WHATSAPP only — stored as `config.whatsapp`. */
  @ValidateIf((o: CreateTemplateDto) => o.type === TemplateType.WHATSAPP)
  @ValidateNested()
  @Type(() => WhatsappConfigDto)
  whatsapp?: WhatsappConfigDto;

  /** REPORT_TEMPLATE only — layout descriptors + HTML, stored as `config`. */
  @ValidateIf((o: CreateTemplateDto) => o.type === TemplateType.REPORT_TEMPLATE)
  @ValidateNested()
  @Type(() => ReportConfigDto)
  report?: ReportConfigDto;

  // ── Shared optional blocks (any type) ────────────────────────────────────────

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
