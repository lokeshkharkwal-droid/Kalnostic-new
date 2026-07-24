import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { DeltaCheckService } from './delta-check.service';
import { UpdateDeltaCheckStatusDto } from './dto/update-worklist-status.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Delta Check worklist endpoints (LABORATORY.docx §8.4). Raising a check lives
 * on `LabReportController` (`POST /lab-reports/:id/delta-check`); this
 * controller covers the worklist's own list/status-update (its own New ->
 * Reviewed -> Re-Run/Accepted -> Completed vocabulary).
 */
@Controller('delta-checks')
export class DeltaCheckController {
  constructor(private readonly deltaCheckService: DeltaCheckService) {}

  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.deltaCheckService.findAll(tenantId, profile.branchId);
  }

  @Patch(':id/status')
  @Audit({
    module: AuditModule.DELTA_CHECK,
    action: AuditAction.UPDATE,
    description: 'Updated a delta check status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: UpdateDeltaCheckStatusDto,
  ) {
    return this.deltaCheckService.updateStatus(
      id,
      tenantId,
      profile.branchId,
      dto,
    );
  }
}
