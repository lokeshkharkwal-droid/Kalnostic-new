import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { TatAdjustmentService } from './tat-adjustment.service';
import { CreateTatAdjustmentDto } from './dto/tat-adjustment.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * "Adjust TAT History" endpoints, nested under a report
 * (`/lab-reports/:id/tat-adjustments`) — Turnaround Time Details modal,
 * Technician/Reporting.
 */
@Controller('lab-reports/:id/tat-adjustments')
export class TatAdjustmentController {
  constructor(private readonly tatAdjustmentService: TatAdjustmentService) {}

  @Post()
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.CREATE,
    description: 'Added a TAT adjustment record',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CreateTatAdjustmentDto,
  ) {
    return this.tatAdjustmentService.create(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.tatAdjustmentService.findAll(id, tenantId, profile.branchId);
  }

  @Delete(':adjustmentId')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.DELETE,
    description: 'Deleted a TAT adjustment record',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Param('adjustmentId') adjustmentId: string,
  ) {
    return this.tatAdjustmentService.remove(
      id,
      adjustmentId,
      tenantId,
      profile.branchId,
    );
  }
}
