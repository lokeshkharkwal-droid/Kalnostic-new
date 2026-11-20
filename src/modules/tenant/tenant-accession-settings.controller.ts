import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TenantService } from './tenant.service';
import { UpdateGroupingModeDto } from './dto/update-grouping-mode.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { extractClientIp } from '../../common/utils/client-ip.util';
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
   * Change the grouping mode NEW orders take. Requires the "Update accession
   * settings" permission. Existing orders keep their own mode and no barcode is
   * touched - see `TenantService.updateGroupingMode`. The audit row (old and new
   * mode) is written by the service in the same transaction, so this route has no
   * `@Audit` decorator (it would add a second, after-the-fact row and one for a
   * save that changed nothing).
   */
  @Put('grouping-mode')
  @RequirePermission(PERMISSION_KEYS.ACC_SETTINGS_UPDATE)
  updateGroupingMode(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Body() dto: UpdateGroupingModeDto,
  ) {
    const roleLabel =
      user.profiles?.find((p) => p.profile_key === user.active_profile_key)
        ?.profile_label ?? null;
    return this.tenantService.updateGroupingMode(tenantId, dto.groupingMode, {
      personId: user.person_id,
      branchId: user.active_branch_id ?? null,
      roleKey: user.active_profile_key ?? null,
      roleLabel,
      ipAddress: extractClientIp(req),
    });
  }
}
