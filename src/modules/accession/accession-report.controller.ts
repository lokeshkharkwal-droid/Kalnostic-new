import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AccessionReportService } from './accession-report.service';
import { AccessionReportQueryDto } from './dto/accession-report-query.dto';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequireAnyPermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';

/**
 * Accession Report endpoints (PDF Part F). Business-authenticated; tenant from the
 * JWT, branch from the active profile. `counts` powers the §F.2 count cards; the
 * list returns the §F.3 data table for one exception type. Viewing requires the
 * "view reports of users" OR "view reports of all users" permission.
 */
@Controller('accession/reports')
@UseGuards(PermissionGuard)
export class AccessionReportController {
  constructor(private readonly reports: AccessionReportService) {}

  /** Exception-status count cards (§F.2). */
  @Get('counts')
  @RequireAnyPermission(
    PERMISSION_KEYS.ACC_REPORTS_VIEW_USERS,
    PERMISSION_KEYS.ACC_REPORTS_VIEW_ALL,
  )
  counts(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.reports.counts(tenantId, profile.branchId);
  }

  /** Exception data table for one report type (§F.3). */
  @Get()
  @RequireAnyPermission(
    PERMISSION_KEYS.ACC_REPORTS_VIEW_USERS,
    PERMISSION_KEYS.ACC_REPORTS_VIEW_ALL,
  )
  list(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: AccessionReportQueryDto,
  ) {
    return this.reports.list(tenantId, profile.branchId, query);
  }
}
