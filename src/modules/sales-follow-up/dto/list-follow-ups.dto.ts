import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { FollowUpStatus, LeadPriority } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Status bucket shortcuts for the follow-up queue tabs. */
export const FOLLOW_UP_STATUS_BUCKETS = [
  'all',
  'scheduled',
  'pending',
  'completed',
  'converted',
  'cancelled',
  'rescheduled',
  'no-response',
] as const;

export type FollowUpStatusBucket = (typeof FOLLOW_UP_STATUS_BUCKETS)[number];

/**
 * Query for listing the active branch's follow-ups: pagination + due-date range +
 * salesperson + priority + status + lead + free-text search + a status bucket
 * shortcut (queue tabs). When both `status` and `statusBucket` are provided,
 * `status` wins (resolved in the service).
 */
export class ListFollowUpsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** ISO date (yyyy-mm-dd) lower bound on due date. */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** ISO date (yyyy-mm-dd) upper bound on due date. */
  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  salespersonId?: string;

  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @IsOptional()
  @IsEnum(FollowUpStatus)
  status?: FollowUpStatus;

  @IsOptional()
  @IsUUID()
  leadId?: string;

  /** Queue-tab shortcut; maps 1:1 to a status except `all` (no filter). */
  @IsOptional()
  @IsIn(FOLLOW_UP_STATUS_BUCKETS)
  statusBucket?: FollowUpStatusBucket;
}
