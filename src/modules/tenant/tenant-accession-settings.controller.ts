import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { TenantService } from './tenant.service';
import { UpdateGroupingModeDto } from './dto/update-grouping-mode.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ProfileGuard } from '../auth/guards/profile.guard';
import { RequireProfile } from '../auth/decorators/require-profile.decorator';

/**
 * Accession Settings that live on the tenant itself, not `AccessionSetting`
 * (which is per-branch). Currently just the Group Settings mode
 * (Kalnostic_LIMS_Accession_Group_Settings.docx) — tenant-wide, configured in
 * business-admin only, never per-branch/per-user. Protected by the global
 * business `JwtAuthGuard`, scoped to the caller's own tenant via
 * `@CurrentTenant()`, distinct from the SiteAdmin `/siteadmin/tenants`
 * controller.
 */
@Controller('tenant/accession-settings')
export class TenantAccessionSettingsController {
  constructor(private readonly tenantService: TenantService) {}

  /** Read the caller tenant's active Group Settings grouping mode. */
  @Get('grouping-mode')
  getGroupingMode(@CurrentTenant() tenantId: string) {
    return this.tenantService.getGroupingMode(tenantId);
  }

  /**
   * Change the caller tenant's Group Settings grouping mode. Business-admin
   * only. Not retroactive — see `TenantService.updateGroupingMode`.
   */
  @Put('grouping-mode')
  @UseGuards(ProfileGuard)
  @RequireProfile('business_admin')
  @Audit({
    module: AuditModule.TENANT,
    action: AuditAction.UPDATE,
    description: 'Updated the Accession Group Settings grouping mode',
  })
  updateGroupingMode(
    @CurrentTenant() tenantId: string,
    @Body() dto: UpdateGroupingModeDto,
  ) {
    return this.tenantService.updateGroupingMode(tenantId, dto.groupingMode);
  }
}
