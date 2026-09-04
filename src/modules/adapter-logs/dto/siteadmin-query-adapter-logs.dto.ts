import { IsOptional, IsString } from 'class-validator';
import { QueryAdapterLogsDto } from './query-adapter-logs.dto';

/**
 * Filters for the SiteAdmin cross-tenant adapter-log list endpoint. Inherits
 * every filter from {@link QueryAdapterLogsDto} (search / action / status /
 * branch / date range + pagination) and adds an optional `tenantId`.
 *
 * Unlike the business endpoint — where a client-supplied tenant id is a red flag
 * (CLAUDE.md §4.7) — SiteAdmin tooling legitimately operates across tenants and
 * may pass `tenantId` explicitly to narrow the view to a single business. When
 * omitted, the endpoint returns adapter logs across **all** businesses.
 */
export class SiteAdminQueryAdapterLogsDto extends QueryAdapterLogsDto {
  /** SiteAdmin-only: restrict the view to a single business/tenant. */
  @IsOptional()
  @IsString()
  tenantId?: string;
}
