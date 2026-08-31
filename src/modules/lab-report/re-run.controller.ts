import { UseGuards, Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { AuditAction, AuditModule } from '@prisma/client';
import { ReRunService } from './re-run.service';
import { UpdateReRunStatusDto } from './dto/update-worklist-status.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Re-Run worklist endpoints (LABORATORY.docx §8.1). Raising a re-run lives on
 * `LabReportController` (`POST /lab-reports/:id/re-run`) since it acts on the
 * report itself; this controller covers the worklist's own list/status-update.
 */
@Controller('re-run-requests')
@UseGuards(PermissionGuard)
export class ReRunController {
  constructor(private readonly reRunService: ReRunService) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.LAB_ACCESS_RE_RUN_LIST)
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.reRunService.findAll(tenantId, profile.branchId);
  }

  @Patch(':id/status')
  @RequirePermission(PERMISSION_KEYS.LAB_UPDATE_RE_RUN)
  @Audit({
    module: AuditModule.RE_RUN_REQUEST,
    action: AuditAction.UPDATE,
    description: 'Updated a re-run request status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReRunStatusDto,
  ) {
    return this.reRunService.updateStatus(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }
}
