import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Appointment status-tracking endpoints. Business-authenticated; tenant comes
 * from the JWT and the branch from the active profile (global `JwtAuthGuard`
 * protects all routes). Writes are audited under `AuditModule.APPOINTMENT`.
 */
@Controller('appointments')
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  /** Create an appointment (generates `APT-00001` + records the initial status). */
  @Post()
  @Audit({
    module: AuditModule.APPOINTMENT,
    action: AuditAction.CREATE,
    description: 'Created an appointment',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.appointmentService.create(
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /** List appointments (paginated, with search + status/type filters). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListAppointmentsDto,
  ) {
    return this.appointmentService.findAll(tenantId, profile.branchId, query);
  }

  /** Fetch one appointment with its status history. */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.appointmentService.findById(id, tenantId);
  }

  /** Fetch an appointment's status-change history (newest first). */
  @Get(':id/history')
  findHistory(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.appointmentService.findHistory(id, tenantId);
  }

  /** Transition an appointment to a new status (records a history entry). */
  @Patch(':id/status')
  @Audit({
    module: AuditModule.APPOINTMENT,
    action: AuditAction.UPDATE,
    description: 'Updated an appointment status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    return this.appointmentService.updateStatus(id, tenantId, personId, dto);
  }

  /** Soft-delete an appointment (history rows are preserved). */
  @Delete(':id')
  @Audit({
    module: AuditModule.APPOINTMENT,
    action: AuditAction.DELETE,
    description: 'Deleted an appointment',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.appointmentService.remove(id, tenantId);
  }
}
