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
import { DoctorScheduleService } from './doctor-schedule.service';
import { DoctorSlotService } from './doctor-slot.service';
import { CreateDoctorScheduleDto } from './dto/create-doctor-schedule.dto';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { TodayQueryDto } from './dto/today-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Doctor Schedule endpoints (business-authenticated; tenant comes from the JWT).
 * Covers the Configure form CRUD, the weekly calendar view, today's slots, and
 * the slot reserve/release counter. The global `JwtAuthGuard` protects all
 * routes. Static sub-paths are declared before `:id` so they aren't captured as
 * ids.
 */
@Controller('doctor-schedules')
export class DoctorScheduleController {
  constructor(
    private readonly scheduleService: DoctorScheduleService,
    private readonly slotService: DoctorSlotService,
  ) {}

  /**
   * Create a doctor schedule and generate its future slots.
   */
  @Post()
  @Audit({
    module: AuditModule.DOCTOR_SCHEDULE,
    action: AuditAction.CREATE,
    description: 'Created a doctor schedule',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateDoctorScheduleDto,
  ) {
    return this.scheduleService.create(tenantId, dto, personId);
  }

  /**
   * Weekly calendar for a doctor (`?doctorId=&weekStart=YYYY-MM-DD`). Prev/next
   * week = a different `weekStart`.
   */
  @Get('calendar')
  calendar(
    @CurrentTenant() tenantId: string,
    @Query() query: CalendarQueryDto,
  ) {
    return this.slotService.getCalendar(
      tenantId,
      query.doctorId,
      query.weekStart,
    );
  }

  /**
   * Today's slots for a doctor (`?doctorId=`), with occupancy ratios.
   */
  @Get('today')
  today(@CurrentTenant() tenantId: string, @Query() query: TodayQueryDto) {
    return this.slotService.getTodaySlots(tenantId, query.doctorId);
  }

  /**
   * Full active-schedule config for a doctor (hydrates the Configure form).
   */
  @Get('doctor/:doctorId')
  findByDoctor(
    @CurrentTenant() tenantId: string,
    @Param('doctorId') doctorId: string,
  ) {
    return this.scheduleService.findByDoctor(tenantId, doctorId);
  }

  /**
   * Reserve one place in a slot (increments the booked counter).
   */
  @Post('slots/:slotId/reserve')
  @Audit({
    module: AuditModule.DOCTOR_SCHEDULE,
    action: AuditAction.UPDATE,
    description: 'Reserved a doctor slot',
  })
  reserve(@CurrentTenant() tenantId: string, @Param('slotId') slotId: string) {
    return this.slotService.reserve(tenantId, slotId);
  }

  /**
   * Release one place in a slot (decrements the booked counter).
   */
  @Post('slots/:slotId/release')
  @Audit({
    module: AuditModule.DOCTOR_SCHEDULE,
    action: AuditAction.UPDATE,
    description: 'Released a doctor slot',
  })
  release(@CurrentTenant() tenantId: string, @Param('slotId') slotId: string) {
    return this.slotService.release(tenantId, slotId);
  }

  /**
   * Fetch one schedule by id (with its days/holidays/overrides).
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.scheduleService.findById(id, tenantId);
  }

  /**
   * Update a schedule; regenerates future unbooked slots.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.DOCTOR_SCHEDULE,
    action: AuditAction.UPDATE,
    description: 'Updated a doctor schedule',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDoctorScheduleDto,
  ) {
    return this.scheduleService.update(id, tenantId, dto, personId);
  }

  /**
   * Soft-delete a schedule (blocked if it has future booked slots).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.DOCTOR_SCHEDULE,
    action: AuditAction.DELETE,
    description: 'Deleted a doctor schedule',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.scheduleService.remove(id, tenantId);
  }
}
