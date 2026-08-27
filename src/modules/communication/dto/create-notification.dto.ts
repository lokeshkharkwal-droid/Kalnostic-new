import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { NotificationKind } from '@prisma/client';

/** One recipient of an in-app notification. */
export class NotificationTargetDto {
  @IsString()
  entityId!: string; // recipient person id

  @IsString()
  entityType!: string; // 'STAFF' | 'PATIENT' | ...

  @IsOptional()
  @IsString()
  name?: string;
}

/**
 * Create an in-app notification (a MESSAGE or an ALERT). The sender (actor) is
 * derived from the JWT; the tenant + branch come from the request context.
 */
export class CreateNotificationDto {
  @IsEnum(NotificationKind)
  kind!: NotificationKind;

  /** Action verb, e.g. 'message' | 'reply_message' | 'report_ready'. */
  @IsString()
  verb!: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  body!: string;

  /** Thread root notification id when this is a reply. */
  @IsOptional()
  @IsString()
  contextId?: string;

  @IsOptional()
  @IsString()
  contextType?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NotificationTargetDto)
  targets!: NotificationTargetDto[];
}
