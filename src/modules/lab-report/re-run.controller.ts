import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { ReRunService } from './re-run.service';
import { RaiseReRunDto } from './dto/re-run.dto';
import { UpdateActionWorklistStatusDto } from './dto/update-worklist-status.dto';
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
export class ReRunController {
  constructor(private readonly reRunService: ReRunService) {}

  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.reRunService.findAll(tenantId, profile.branchId);
  }

  @Patch(':id/status')
  @Audit({
    module: AuditModule.RE_RUN_REQUEST,
    action: AuditAction.UPDATE,
    description: 'Updated a re-run request status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: UpdateActionWorklistStatusDto,
  ) {
    return this.reRunService.updateStatus(id, tenantId, profile.branchId, dto);
  }
}
