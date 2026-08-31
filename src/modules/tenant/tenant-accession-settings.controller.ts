import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { TenantService } from './tenant.service';
import { UpdateGroupingModeDto } from './dto/update-grouping-mode.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';

/**
 * Accession Settings that live on the tenant itself, not `AccessionSetting`
 * (which is per-branch). Currently just the Group Settings mode
 * (Kalnostic_LIMS_Accession_Group_Settings.docx) — tenant-wide, configured from
 * the business-admin Accession Settings page. Protected by the global business
 * `JwtAuthGuard`, scoped to the caller's own tenant via `@CurrentTenant()`, and
 * gated by the same "Accession Settings" permissions as the per-branch
 * `AccessionSettingsController` so the grant is manageable from the user
 * permission modal (`business_admin`/`administrator` bypass — see
 * `PermissionCheckService`). Distinct from the SiteAdmin `/siteadmin/tenants`
 * controller.
 */
@Controller('tenant/accession-settings')
@UseGuards(PermissionGuard)
export class TenantAccessionSettingsController {
  constructor(private readonly tenantService: TenantService) {}

  /** Read the caller tenant's active Group Settings grouping mode. */
  @Get('grouping-mode')
  @RequirePermission(PERMISSION_KEYS.ACC_SETTINGS_VIEW)
  getGroupingMode(@CurrentTenant() tenantId: string) {
    return this.tenantService.getGroupingMode(tenantId);
  }

  /**
   * Change the caller tenant's Group Settings grouping mode. Requires the
   * "Update accession settings" permission. Not retroactive — see
   * `TenantService.updateGroupingMode`.
   */
  @Put('grouping-mode')
  @RequirePermission(PERMISSION_KEYS.ACC_SETTINGS_UPDATE)
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
