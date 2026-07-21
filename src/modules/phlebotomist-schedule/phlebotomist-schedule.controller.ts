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
import { PhlebotomistScheduleService } from './phlebotomist-schedule.service';
import { PhlebotomistSlotService } from './phlebotomist-slot.service';
import { CreatePhlebotomistScheduleDto } from './dto/create-phlebotomist-schedule.dto';
import { UpdatePhlebotomistScheduleDto } from './dto/update-phlebotomist-schedule.dto';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { TodayQueryDto } from './dto/today-query.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ActiveBranchRequiredException } from './exceptions/phlebotomist-schedule.exceptions';

/**
 * Phlebotomist Schedule endpoints (business-authenticated; tenant + active branch
 * come from the JWT, never the body — CLAUDE.md §4.7). Covers the Configure form
 * CRUD, the weekly calendar view, and today's slots. The global `JwtAuthGuard`
 * protects all routes. Static sub-paths are declared before `:id` so they aren't
 * captured as ids.
 */
@Controller('phlebotomist-schedules')
export class PhlebotomistScheduleController {
  constructor(
    private readonly scheduleService: PhlebotomistScheduleService,
    private readonly slotService: PhlebotomistSlotService,
  ) {}

  /** Ensure the caller has an active branch, or throw. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** Create a phlebotomist schedule and generate its future slots. */
  @Post()
  @Audit({
    module: AuditModule.PHLEBOTOMIST_SCHEDULE,
    action: AuditAction.CREATE,
    description: 'Created a phlebotomist schedule',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreatePhlebotomistScheduleDto,
  ) {
    return this.scheduleService.create(
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /**
   * Weekly calendar for a phlebotomist (`?phlebotomistId=&weekStart=YYYY-MM-DD`).
   * Prev/next week = a different `weekStart`.
   */
  @Get('calendar')
  calendar(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: CalendarQueryDto,
  ) {
    return this.slotService.getCalendar(
      tenantId,
      this.requireBranch(profile),
      query.phlebotomistId,
      query.weekStart,
    );
  }

  /** Today's slots for a phlebotomist (`?phlebotomistId=`), with occupancy ratios. */
  @Get('today')
  today(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: TodayQueryDto,
  ) {
    return this.slotService.getTodaySlots(
      tenantId,
      this.requireBranch(profile),
      query.phlebotomistId,
    );
  }

  /** Full active-schedule config for a phlebotomist (hydrates the Configure form). */
  @Get('phlebotomist/:phlebotomistId')
  findByPhlebotomist(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('phlebotomistId') phlebotomistId: string,
  ) {
    return this.scheduleService.findByPhlebotomist(
      tenantId,
      this.requireBranch(profile),
      phlebotomistId,
    );
  }

  /** Fetch one schedule by id (with its days/zones/holidays/overrides). */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.scheduleService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Update a schedule; regenerates future unbooked slots. */
  @Patch(':id')
  @Audit({
    module: AuditModule.PHLEBOTOMIST_SCHEDULE,
    action: AuditAction.UPDATE,
    description: 'Updated a phlebotomist schedule',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePhlebotomistScheduleDto,
  ) {
    return this.scheduleService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Soft-delete a schedule (blocked if it has future booked visits). */
  @Delete(':id')
  @Audit({
    module: AuditModule.PHLEBOTOMIST_SCHEDULE,
    action: AuditAction.DELETE,
    description: 'Deleted a phlebotomist schedule',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.scheduleService.remove(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }
}
