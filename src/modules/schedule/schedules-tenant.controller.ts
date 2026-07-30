import { Controller, Get, Query } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ListTenantScheduleQueryDto } from './dto/list-tenant-schedule-query.dto';

/**
 * Tenant-wide schedule listing (`GET /schedules`). Unlike the branch-nested
 * `GET /branches/:branchId/schedules`, this lists schedule plans across every
 * branch in the caller's tenant, with an optional `branchId` filter — powering
 * the Business-Admin "Schedule Plans" screen (list + branch filter). Tenant
 * comes from the JWT; the global `JwtAuthGuard` protects the route.
 */
@Controller('schedules')
export class SchedulesTenantController {
  constructor(private readonly scheduleService: ScheduleService) {}

  /**
   * List schedules for the whole tenant (paginated). Optional `search` (matches
   * the plan name, case-insensitive), `status` and `branchId` filters. Each row
   * carries its branch `{ id, name, code }` for display.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListTenantScheduleQueryDto,
  ) {
    return this.scheduleService.findAllForTenant(
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
      { search: query.search, status: query.status, branchId: query.branchId },
    );
  }
}
