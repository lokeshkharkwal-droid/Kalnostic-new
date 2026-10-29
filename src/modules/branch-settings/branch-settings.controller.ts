import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { BranchSettingsService } from './branch-settings.service';
import { SaveReportPrintingSettingsDto } from './dto/save-report-printing-settings.dto';

/**
 * Branch Admin › Branch Settings. Business-authenticated; tenant from the JWT, the
 * branch is the caller's active branch (never sent in a body). Gated by the
 * `branch_admin` Branch Settings permissions, which lab roles do not hold.
 */
@Controller('branch-settings')
@UseGuards(PermissionGuard)
export class BranchSettingsController {
  constructor(private readonly branchSettings: BranchSettingsService) {}

  /** The active branch's report-printing settings. */
  @Get('report-printing')
  @RequirePermission(PERMISSION_KEYS.BR_SETTINGS_VIEW)
  getReportPrinting(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.branchSettings.getReportPrinting(
      tenantId,
      profile.branchId ?? '',
    );
  }

  /** Save the active branch's report-printing settings. */
  @Put('report-printing')
  @RequirePermission(PERMISSION_KEYS.BR_SETTINGS_UPDATE)
  @Audit({
    module: AuditModule.TECHNICIAN_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated branch report-printing settings',
  })
  saveReportPrinting(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: SaveReportPrintingSettingsDto,
  ) {
    return this.branchSettings.saveReportPrinting(
      tenantId,
      profile.branchId ?? '',
      dto,
    );
  }
}
