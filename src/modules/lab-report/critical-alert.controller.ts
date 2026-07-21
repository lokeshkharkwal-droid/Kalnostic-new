import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { CriticalAlertService } from './critical-alert.service';
import { UpdateWorklistStatusDto } from './dto/update-worklist-status.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Critical Alerts worklist endpoints (LABORATORY.docx §8.2). Raising an alert
 * lives on `LabReportController` (`POST /lab-reports/:id/critical-alert`);
 * this controller covers the worklist's own list/status-update. Per CR-02, no
 * "raise again" action is exposed here.
 */
@Controller('critical-alerts')
export class CriticalAlertController {
  constructor(private readonly criticalAlertService: CriticalAlertService) {}

  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.criticalAlertService.findAll(tenantId, profile.branchId);
  }

  @Patch(':id/status')
  @Audit({
    module: AuditModule.CRITICAL_ALERT,
    action: AuditAction.UPDATE,
    description: 'Updated a critical alert status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: UpdateWorklistStatusDto,
  ) {
    return this.criticalAlertService.updateStatus(
      id,
      tenantId,
      profile.branchId,
      dto,
    );
  }
}
