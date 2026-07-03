import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for `GET /roles` — pagination plus an optional case-insensitive search
 * (matched against `name` or `key`), an active/inactive `status` filter, and a
 * `scope` filter to narrow to only system or only custom roles.
 */
export class ListAuthRolesQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against `name` or `key`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Filter by active (`ACTIVE`) or inactive (`INACTIVE`) roles. */
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  /** Narrow to only `SYSTEM` (global seeded) or `CUSTOM` (tenant-defined) roles. */
  @IsOptional()
  @IsIn(['SYSTEM', 'CUSTOM'])
  @Type(() => String)
  scope?: 'SYSTEM' | 'CUSTOM';
}
