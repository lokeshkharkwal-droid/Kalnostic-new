import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { ScheduledTestService } from './scheduled-test.service';
import { ScheduleTestDto } from './dto/schedule-test.dto';
import { UpdateActionWorklistStatusDto } from './dto/update-worklist-status.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Schedule Test worklist endpoints (LABORATORY.docx §8.5). Creating a schedule
 * lives on `LabReportController` (`POST /lab-reports/:id/schedule`); per CR-03
 * there is no standalone create-from-worklist route here — only reschedule and
 * status update on an existing row.
 */
@Controller('scheduled-tests')
export class ScheduledTestController {
  constructor(private readonly scheduledTestService: ScheduledTestService) {}

  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.scheduledTestService.findAll(tenantId, profile.branchId);
  }

  @Patch(':id')
  @Audit({
    module: AuditModule.SCHEDULED_TEST,
    action: AuditAction.UPDATE,
    description: 'Rescheduled a test',
  })
  reschedule(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: ScheduleTestDto,
  ) {
    return this.scheduledTestService.reschedule(
      id,
      tenantId,
      profile.branchId,
      dto,
    );
  }

  @Patch(':id/status')
  @Audit({
    module: AuditModule.SCHEDULED_TEST,
    action: AuditAction.UPDATE,
    description: 'Updated a scheduled test status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: UpdateActionWorklistStatusDto,
  ) {
    return this.scheduledTestService.updateStatus(
      id,
      tenantId,
      profile.branchId,
      dto,
    );
  }
}
