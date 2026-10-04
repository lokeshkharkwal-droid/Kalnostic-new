import { TechnicianBranchAccessService } from './access/technician-branch-access.service';
import {
  ReportBranchScope,
  ReportBranchScopeGuard,
} from './access/report-branch-scope.guard';
import { WorklistBranchQueryDto } from './dto/worklist-branch-query.dto';
import {
  UseGuards,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { AuditAction, AuditModule } from '@prisma/client';
import { CriticalAlertService } from './critical-alert.service';
import { UpdateAlertReviewStatusDto } from './dto/update-worklist-status.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Critical Alerts worklist endpoints (LABORATORY.docx §8.2). Raising an alert
 * lives on `LabReportController` (`POST /lab-reports/:id/critical-alert`);
 * this controller covers the worklist's own list/status-update. Per CR-02, no
 * "raise again" action is exposed here.
 */
@Controller('critical-alerts')
@UseGuards(ReportBranchScopeGuard, PermissionGuard)
@ReportBranchScope({ entity: 'criticalAlert' })
export class CriticalAlertController {
  constructor(
    private readonly criticalAlertService: CriticalAlertService,
    private readonly branchAccess: TechnicianBranchAccessService,
  ) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.LAB_ACCESS_CRITICAL_LIST)
  async findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: WorklistBranchQueryDto,
  ) {
    const scope = await this.branchAccess.resolveScope(
      tenantId,
      personId,
      profile,
      query.branchId,
      PERMISSION_KEYS.LAB_ACCESS_CRITICAL_LIST,
    );
    return this.criticalAlertService.findAll(tenantId, scope);
  }

  @Patch(':id/status')
  @RequirePermission(PERMISSION_KEYS.LAB_UPDATE_CRITICAL)
  @Audit({
    module: AuditModule.CRITICAL_ALERT,
    action: AuditAction.UPDATE,
    description: 'Updated a critical alert status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAlertReviewStatusDto,
  ) {
    return this.criticalAlertService.updateStatus(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }
}
