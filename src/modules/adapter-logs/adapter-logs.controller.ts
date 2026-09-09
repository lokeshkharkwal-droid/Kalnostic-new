import { Controller, Get, Param, Query } from '@nestjs/common';
import { AdapterLogsService } from './adapter-logs.service';
import { QueryAdapterLogsDto } from './dto/query-adapter-logs.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';

/**
 * Adapter-log read endpoints (business-authenticated; tenant + active branch
 * come from the JWT). The global `JwtAuthGuard` protects all routes. Adapter
 * rows are written only by the EMI adapter layer — never by clients — so there
 * are no create/update/delete routes here.
 *
 * Scope is derived from the active profile: `business_admin` sees every branch
 * in its tenant; a branch-scoped profile (e.g. `branch_admin`) is locked to its
 * own branch (see `AdapterLogsService.findAllForContext`).
 */
@Controller('adapter-logs')
export class AdapterLogsController {
  constructor(private readonly adapterLogsService: AdapterLogsService) {}

  /**
   * List adapter logs in the caller's tenant/branch scope (paginated, filterable).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: QueryAdapterLogsDto,
  ) {
    return this.adapterLogsService.findAllForContext(tenantId, profile, query);
  }

  /**
   * Fetch one adapter log by id (tenant-scoped).
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.adapterLogsService.findById(id, tenantId);
  }
}
