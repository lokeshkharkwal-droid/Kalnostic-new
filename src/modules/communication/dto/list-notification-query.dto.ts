import { IsEnum, IsOptional, IsString } from 'class-validator';
import { NotificationKind } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';

/**
 * Filters for the in-app notification list (extends offset pagination). The
 * recipient (`entityId`) comes from the JWT in the controller, not the query.
 */
export class ListNotificationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(NotificationKind)
  kind?: NotificationKind;

  /** When true, only unread notifications for the caller. */
  @IsOptional()
  @ToBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsString()
  search?: string;
}
