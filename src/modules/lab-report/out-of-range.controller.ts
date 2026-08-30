import { UseGuards, Body, Controller, Get, Param, Patch } from '@nestjs/common';
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
@UseGuards(PermissionGuard)
export class OutOfRangeController {
  constructor(private readonly outOfRangeService: OutOfRangeService) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.LAB_ACCESS_OOR)
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.outOfRangeService.findAll(tenantId, profile.branchId);
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
