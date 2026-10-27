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
import { DeltaCheckService } from './delta-check.service';
import { UpdateAlertReviewStatusDto } from './dto/update-worklist-status.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Delta Check worklist endpoints (LABORATORY.docx §8.4). Raising a check lives
 * on `LabReportController` (`POST /lab-reports/:id/delta-check`); this
 * controller covers the worklist's own list/status-update (the shared
 * `AlertReviewStatus` vocabulary: New -> Acknowledged -> Under Review ->
 * Initiate Rerun -> In Progress -> Rerun Completed -> Accept & Release ->
 * Resolved).
 */
@Controller('delta-checks')
@UseGuards(ReportBranchScopeGuard, PermissionGuard)
@ReportBranchScope({ entity: 'deltaCheck' })
export class DeltaCheckController {
  constructor(
    private readonly deltaCheckService: DeltaCheckService,
    private readonly branchAccess: TechnicianBranchAccessService,
  ) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.LAB_ACCESS_DELTA_LIST)
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
      PERMISSION_KEYS.LAB_ACCESS_DELTA_LIST,
    );
    return this.deltaCheckService.findAll(tenantId, scope);
  }

  @Patch(':id/status')
  @RequirePermission(PERMISSION_KEYS.LAB_UPDATE_DELTA)
  @Audit({
    module: AuditModule.DELTA_CHECK,
    action: AuditAction.UPDATE,
    description: 'Updated a delta check status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAlertReviewStatusDto,
  ) {
    return this.deltaCheckService.updateStatus(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }
}
