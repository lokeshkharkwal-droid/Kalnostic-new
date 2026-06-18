import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Columns the user list may be sorted on (v2.0 spec). */
export const USER_SORT_FIELDS = [
  'userCode',
  'employeeName',
  'email',
  'mobile',
  'role',
  'assignedBranches',
  'defaultBranch',
  'defaultModule',
  'status',
] as const;

export type UserSortField = (typeof USER_SORT_FIELDS)[number];

/**
 * Query params for List Users: pagination (inherited) + free-text search +
 * branch/role/module filters + sorting. Realtime-search compatible.
 */
export class ListUsersQueryDto extends PaginationQueryDto {
  /** Matches employeeName, username, email, or userCode (case-insensitive). */
  @IsString()
  @IsOptional()
  search?: string;

  /** Filter to users assigned to this branch. */
  @IsString()
  @IsOptional()
  branchId?: string;

  /** Filter by role key. */
  @IsString()
  @IsOptional()
  role?: string;

  /** Filter to users whose default module (on any branch) matches this key. */
  @IsString()
  @IsOptional()
  moduleKey?: string;

  @IsIn(USER_SORT_FIELDS as readonly string[])
  @IsOptional()
  sortBy?: UserSortField;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortOrder?: 'asc' | 'desc';
}
