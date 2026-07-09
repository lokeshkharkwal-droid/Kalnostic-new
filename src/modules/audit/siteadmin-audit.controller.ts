import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { SiteAdminQueryAuditDto } from './dto/siteadmin-query-audit.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin cross-tenant audit-log view (`/siteadmin/audits`). Lists audit rows
 * across **all** businesses (or a single one via `?tenantId=`), enriched with the
 * actor's name/username and the business name.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`, gated on
 * `audit-logs:read` (operations_admin and above — CLAUDE.md §5.2). Distinct from
 * the tenant-scoped `/audits` (business JWT) that a business uses for its own trail.
 */
@Controller('siteadmin/audits')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminAuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * List audit logs across all businesses (paginated, filterable by module /
   * action / actor / branch / date range, free-text `search`, and optional
   * `tenantId`).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.AUDIT_LOGS_READ)
  findAll(@Query() query: SiteAdminQueryAuditDto) {
    return this.auditService.findAllForSiteAdmin(query);
  }
}
