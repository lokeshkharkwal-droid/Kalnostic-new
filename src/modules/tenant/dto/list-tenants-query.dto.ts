import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SubscriptionStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for `GET /siteadmin/tenants`. Extends the shared pagination DTO
 * (`page` / `limit`) with the admin search-bar filters:
 *
 * - `search` — case-insensitive substring matched against a tenant's name,
 *   slug or contact email.
 * - `status` — exact `subscriptionStatus`. Accepted case-insensitively
 *   (the frontend sends lowercase) and normalised to the Prisma enum.
 */
export class ListTenantsQueryDto extends PaginationQueryDto {
  /** Free-text search over name / slug / email (optional). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Subscription status filter (optional). */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;
}
