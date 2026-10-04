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
import { OutOfRangeService } from './out-of-range.service';
import { UpdateAlertReviewStatusDto } from './dto/update-worklist-status.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Out of Range worklist endpoints (LABORATORY.docx §8.3). Raising a flag lives
 * on `LabReportController` (`POST /lab-reports/:id/out-of-range`); this
 * controller covers the worklist's own list/status-update.
 */
@Controller('out-of-range-flags')
@UseGuards(ReportBranchScopeGuard, PermissionGuard)
@ReportBranchScope({ entity: 'outOfRangeFlag' })
export class OutOfRangeController {
  constructor(
    private readonly outOfRangeService: OutOfRangeService,
    private readonly branchAccess: TechnicianBranchAccessService,
  ) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.LAB_ACCESS_OOR)
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
      PERMISSION_KEYS.LAB_ACCESS_OOR,
    );
    return this.outOfRangeService.findAll(tenantId, scope);
  }

  @Patch(':id/status')
  @RequirePermission(PERMISSION_KEYS.LAB_UPDATE_OOR)
  @Audit({
    module: AuditModule.OUT_OF_RANGE_FLAG,
    action: AuditAction.UPDATE,
    description: 'Updated an out-of-range flag status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAlertReviewStatusDto,
  ) {
    return this.outOfRangeService.updateStatus(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }
}
