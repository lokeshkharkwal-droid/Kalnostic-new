import { IsOptional, IsString } from 'class-validator';
import { QueryAuditDto } from './query-audit.dto';

/**
 * Filters for the SiteAdmin cross-tenant audit-log list endpoint. Inherits every
 * filter from {@link QueryAuditDto} (search / module / action / actor / branch /
 * date range + pagination) and adds an optional `tenantId`.
 *
 * Unlike the business endpoint — where a client-supplied tenant id is a red flag
 * (CLAUDE.md §4.7) — SiteAdmin tooling legitimately operates across tenants and
 * may pass `tenantId` explicitly to narrow the view to a single business. When
 * omitted, the endpoint returns audit rows across **all** businesses.
 */
export class SiteAdminQueryAuditDto extends QueryAuditDto {
  /** SiteAdmin-only: restrict the view to a single business/tenant. */
  @IsOptional()
  @IsString()
  tenantId?: string;
}
