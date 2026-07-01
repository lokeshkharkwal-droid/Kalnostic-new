import { WhatsappTemplateCategory } from '@prisma/client';
import { IsEnum, IsString, MaxLength } from 'class-validator';

/**
 * WHATSAPP type-specific payload. Stored as `Template.config.whatsapp`:
 * `{ templateCategory, approvedTemplateId }`. The approved template id is the
 * WhatsApp Business Platform identifier for the pre-approved template.
 */
export class WhatsappConfigDto {
  @IsEnum(WhatsappTemplateCategory)
  templateCategory: WhatsappTemplateCategory;

  @IsString()
  @MaxLength(255)
  approvedTemplateId: string;
}
