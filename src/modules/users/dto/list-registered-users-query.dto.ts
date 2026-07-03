import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for `GET /siteadmin/registered-users` (SiteAdmin cross-portal
 * listing). Extends the shared pagination DTO (`page` / `limit`) with:
 *
 * - `search` — case-insensitive substring matched against the person's
 *   `email` or login `system_username`.
 * - `status` — `active` / `inactive`, mapped to the platform-level
 *   `Person.isActive` flag.
 */
export class ListRegisteredUsersQueryDto extends PaginationQueryDto {
  /** Free-text search over username / email (optional). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Account status filter — maps to `Person.isActive` (optional). */
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}
