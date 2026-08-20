import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { ATTACHMENT_ENTITY_TYPES } from '../attachment-entity-types';
import type { AttachmentEntityType } from '../attachment-entity-types';

/**
 * Record one uploaded file against an owner record. The bytes are already in S3
 * (via `POST /uploads/attachment`); only the returned `url` + metadata are stored.
 */
export class CreateAttachmentDto {
  /** Owner kind (allow-listed slug). */
  @IsIn(ATTACHMENT_ENTITY_TYPES as readonly string[])
  entityType: AttachmentEntityType;

  /** Owner record id. */
  @IsString()
  @MaxLength(64)
  entityId: string;

  /** Optional sub-category within the owner (e.g. "CONSENT", "EVIDENCE"). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  /** The stored file URL (S3). */
  @IsUrl()
  url: string;

  /** Original file name (for display). */
  @IsString()
  @MaxLength(255)
  fileName: string;

  /** Optional MIME type. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  mimeType?: string;

  /** Optional size in bytes. */
  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;
}
