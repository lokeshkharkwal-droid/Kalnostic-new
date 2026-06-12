import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SiteAdminRole } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for `GET /siteadmin/users`. Extends the shared pagination DTO
 * (`page` / `limit`) with the admin search-bar filters:
 *
 * - `search` — case-insensitive substring matched against first/last name
 *   or email.
 * - `status` — `active` / `inactive`, mapped to the `isActive` boolean.
 * - `role` — exact `SiteAdminRole`. Accepted case-insensitively (the frontend
 *   sends lowercase) and normalised to the Prisma enum.
 */
export class ListSiteAdminUsersQueryDto extends PaginationQueryDto {
  /** Free-text search over first name / last name / email (optional). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Account status filter — maps to `isActive` (optional). */
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  /** SiteAdmin role filter (optional). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(SiteAdminRole)
  role?: SiteAdminRole;
}
