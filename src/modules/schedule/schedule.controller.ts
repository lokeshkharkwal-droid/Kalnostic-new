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
import { ScheduleService } from './schedule.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { AuditAction, AuditModule } from '@prisma/client';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Schedule endpoints, nested under a branch (`/branches/:branchId/schedules`).
 * Business-authenticated; tenant comes from the JWT and the branch from the
 * route (validated against the tenant in the service). The global
 * `JwtAuthGuard` protects all routes.
 */
@Controller('branches/:branchId/schedules')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  /**
   * Create a schedule for the branch.
   */
  @Post()
  @Audit({
    module: AuditModule.SCHEDULE,
    action: AuditAction.CREATE,
    description: 'Created a schedule',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('branchId') branchId: string,
    @Body() dto: CreateScheduleDto,
  ) {
    return this.scheduleService.create(tenantId, branchId, dto, personId);
  }

  /**
   * List schedules for the branch (paginated).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('branchId') branchId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.scheduleService.findAllForBranch(
      tenantId,
      branchId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Fetch one schedule by id.
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.scheduleService.findById(id, tenantId, branchId);
  }

  /**
   * Update a schedule.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.SCHEDULE,
    action: AuditAction.UPDATE,
    description: 'Updated a schedule',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.scheduleService.update(id, tenantId, branchId, dto, personId);
  }

  /**
   * Soft-delete a schedule.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.SCHEDULE,
    action: AuditAction.DELETE,
    description: 'Deleted a schedule',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.scheduleService.remove(id, tenantId, branchId);
  }
}
