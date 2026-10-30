import { IsString, IsUUID } from 'class-validator';

/**
 * Query params for the SiteAdmin "reset Abnormal Flag Logic to Bold" maintenance
 * endpoint. All of the given tenant's reference ranges and reference values
 * currently set to `BOLD_AND_RED` ("Bold and Red") are changed to `BOLD_ONLY`
 * ("Bold").
 *
 * `tenantId` is required and comes from the query string. Unlike ordinary
 * business endpoints, the tenant is supplied explicitly here on purpose: this is
 * SiteAdmin cross-tenant tooling, the one sanctioned place that operates across
 * tenants (CLAUDE.md §4.7).
 */
export class ResetAbnormalFlagLogicQueryDto {
  @IsString()
  @IsUUID()
  tenantId: string;
}
