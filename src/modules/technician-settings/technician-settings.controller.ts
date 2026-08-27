import { UseGuards, Body, Controller, Get, Put } from '@nestjs/common';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { AuditAction, AuditModule } from '@prisma/client';
import { TechnicianSettingsService } from './technician-settings.service';
import { SaveTechnicianSettingsDto } from './dto/save-technician-settings.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Technician Laboratory settings endpoints (Analytical TAT thresholds +
 * Laboratory Permissions). Business-authenticated; tenant from the JWT,
 * branch from the active profile. `GET` returns the branch's settings
 * (created with defaults on first access); `PUT` upserts them.
 */
@Controller('technician-settings')
@UseGuards(PermissionGuard)
export class TechnicianSettingsController {
  constructor(private readonly settings: TechnicianSettingsService) {}

  /** Effective technician settings for the active branch. */
  @Get()
  @RequirePermission(PERMISSION_KEYS.LAB_SETTINGS_VIEW)
  get(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.settings.getForBranch(tenantId, profile.branchId ?? '');
  }

  /** Save (upsert) the active branch's technician settings. */
  @Put()
  @RequirePermission(PERMISSION_KEYS.LAB_SETTINGS_UPDATE)
  @Audit({
    module: AuditModule.TECHNICIAN_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated technician settings',
  })
  save(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: SaveTechnicianSettingsDto,
  ) {
    return this.settings.saveForBranch(tenantId, profile.branchId ?? '', dto);
  }
}
