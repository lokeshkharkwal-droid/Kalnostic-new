import { Controller, Get, Query } from '@nestjs/common';
import { LabAdapterService } from './lab-adapter.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { LabAdapterOptionsQueryDto } from './dto/lab-adapter-options-query.dto';

/**
 * Lab Adapter **options** endpoint (`GET /lab-adapters/options`) — a
 * lightweight `{ id, name }` selector for the Reference Range Master's
 * Analyzer picker (Adapter-wise reference ranges). Separate from the CRUD
 * controller (mirrors `EquipmentOptionsController`/
 * `BranchLabTestOptionsController`) and declared before it in the module's
 * `controllers: []` so `/lab-adapters/options` resolves before the CRUD
 * controller's `/lab-adapters/:id`.
 * Business-authenticated; tenant from the JWT (`@CurrentTenant`). `branchId`
 * is an optional client-supplied filter (never trusted for write — read-only
 * here), since Business Admin has no single active branch to default to.
 */
@Controller('lab-adapters')
export class LabAdapterOptionsController {
  constructor(private readonly labAdapterService: LabAdapterService) {}

  /**
   * Lightweight `{ id, name }` options for the searchable Analyzer selector —
   * the tenant's active adapters, optionally filtered by `branchId` and/or
   * `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @Query() query: LabAdapterOptionsQueryDto,
  ) {
    return this.labAdapterService.findOptions(tenantId, {
      branchId: query.branchId,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }
}
