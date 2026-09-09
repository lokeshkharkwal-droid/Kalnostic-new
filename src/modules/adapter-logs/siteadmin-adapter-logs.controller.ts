import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdapterLogsService } from './adapter-logs.service';
import { SiteAdminQueryAdapterLogsDto } from './dto/siteadmin-query-adapter-logs.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin cross-tenant adapter-log view (`/siteadmin/adapter-logs`). Lists
 * adapter logs across **all** businesses (or a single one via `?tenantId=`),
 * enriched with the owning business name.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`, gated on
 * `adapter-logs:read` (operations_admin and above — CLAUDE.md §5.2). Distinct
 * from the tenant-scoped `/adapter-logs` (business JWT) a business uses for its
 * own logs.
 */
@Controller('siteadmin/adapter-logs')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminAdapterLogsController {
  constructor(private readonly adapterLogsService: AdapterLogsService) {}

  /**
   * List adapter logs across all businesses (paginated, filterable by action /
   * status / branch / date range, free-text `search`, and optional `tenantId`).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.ADAPTER_LOGS_READ)
  findAll(@Query() query: SiteAdminQueryAdapterLogsDto) {
    return this.adapterLogsService.findAllForSiteAdmin(query);
  }
}
