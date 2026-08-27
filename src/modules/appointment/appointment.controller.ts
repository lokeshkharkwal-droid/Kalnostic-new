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
import { AuditAction, AuditModule, AppointmentStatus } from '@prisma/client';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
import { PermissionCheckService } from '../permissions/services/permission-check.service';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
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
  constructor(
    private readonly appointmentService: AppointmentService,
    private readonly permissionCheck: PermissionCheckService,
  ) {}

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

  /**
   * Transition an appointment to a new status (records a history entry). One
   * endpoint serves every transition, so the required permission is resolved
   * from the target `dto.status`: Confirm / Check-in have their own keys; a
   * Cancel needs either cancel-appointment permission (with or without refund);
   * any other transition needs the generic "Update appointment" permission.
   */
  @Patch(':id/status')
  @Audit({
    module: AuditModule.APPOINTMENT,
    action: AuditAction.UPDATE,
    description: 'Updated an appointment status',
  })
  async updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    const ctx = {
      tenantId,
      personId,
      branchId: profile.branchId,
      profileKey: profile.profileKey,
    };
    if (dto.status === AppointmentStatus.CONFIRMED) {
      await this.permissionCheck.assert(
        ctx,
        PERMISSION_KEYS.REG_CONFIRM_APPOINTMENT,
      );
    } else if (dto.status === AppointmentStatus.CHECKED_IN) {
      await this.permissionCheck.assert(
        ctx,
        PERMISSION_KEYS.REG_CHECKIN_APPOINTMENT,
      );
    } else if (dto.status === AppointmentStatus.CANCELLED) {
      await this.permissionCheck.assertAny(ctx, [
        PERMISSION_KEYS.REG_CANCEL_APPOINTMENT_WITH_REFUND,
        PERMISSION_KEYS.REG_CANCEL_APPOINTMENT_WITHOUT_REFUND,
      ]);
    } else {
      await this.permissionCheck.assert(
        ctx,
        PERMISSION_KEYS.REG_UPDATE_APPOINTMENT,
      );
    }
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
