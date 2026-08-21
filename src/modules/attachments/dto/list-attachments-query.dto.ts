import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ATTACHMENT_ENTITY_TYPES } from '../attachment-entity-types';
import type { AttachmentEntityType } from '../attachment-entity-types';

/** Filter attachments by their owner (and optionally category). */
export class ListAttachmentsQueryDto {
  @IsIn(ATTACHMENT_ENTITY_TYPES as readonly string[])
  entityType: AttachmentEntityType;

  @IsString()
  @MaxLength(64)
  entityId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;
}
