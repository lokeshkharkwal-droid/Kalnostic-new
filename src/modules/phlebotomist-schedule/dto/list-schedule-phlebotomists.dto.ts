import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import type { PhlebotomistCurrentStatus } from '../entities/phlebotomist-schedule.entity';

/** Sortable columns for the Phlebotomist List (Tab 1). */
export type PhlebotomistListSortBy =
  | 'name'
  | 'branch'
  | 'zone'
  | 'assignedVisits'
  | 'completedVisits'
  | 'phlebotomyCount'
  | 'currentStatus';

const SORT_BY: PhlebotomistListSortBy[] = [
  'name',
  'branch',
  'zone',
  'assignedVisits',
  'completedVisits',
  'phlebotomyCount',
  'currentStatus',
];

const STATUS: PhlebotomistCurrentStatus[] = [
  'Available',
  'On Route',
  'Inactive',
];

/**
 * Query for the Phlebotomist List tab: paginated list of the active branch's
 * phlebotomists enriched with dynamic visit counts. Supports a name `search`, a
 * `zoneId` filter (schedules serving that area), a `status` filter, and sorting.
 */
export class ListSchedulePhlebotomistsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsOptional()
  @IsIn(STATUS)
  status?: PhlebotomistCurrentStatus;

  @IsOptional()
  @IsIn(SORT_BY)
  sortBy?: PhlebotomistListSortBy;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
