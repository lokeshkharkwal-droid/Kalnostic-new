import { Body, Controller, Get, Put, Query, UseFilters } from '@nestjs/common';
import { InventoryConsumptionService } from './inventory-consumption.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { InventoryUpstreamExceptionFilter } from './filters/inventory-upstream-exception.filter';
import {
  SaveOrderAdjustmentDto,
  SaveTestAdjustmentDto,
} from './dto/inventory-adjustment.dto';

/**
 * Registration-facing inventory integration. The tooltip on `/registration/create`
 * calls this to learn whether a selected branch lab test is mapped to a proforma
 * at the active branch, and (if so) its products' live stock + alert levels. Tenant
 * + active branch come from the JWT; the frontend only passes the branch lab test.
 */
@Controller('inventory')
@UseFilters(InventoryUpstreamExceptionFilter)
export class InventoryIntegrationController {
  constructor(private readonly service: InventoryConsumptionService) {}

  /** Proforma + product/stock info for a selected branch lab test (tooltip). */
  @Get('proforma-info')
  proformaInfo(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query('branchLabTestId') branchLabTestId: string,
  ) {
    return this.service.proformaInfo(
      tenantId,
      profile.branchId,
      branchLabTestId,
    );
  }

  // ── Manual inventory adjustment (Technician Reporting) ──────────────────────
  // The order's own branch (resolved from the order) is used for stock, never the
  // caller's active branch. The tenant comes from the JWT.

  /** Order-level manual adjustment view (products across the order's proformas). */
  @Get('order-adjustment')
  loadOrderAdjustment(
    @CurrentTenant() tenantId: string,
    @Query('orderId') orderId: string,
  ) {
    return this.service.loadOrderAdjustment(tenantId, orderId);
  }

  /** Apply an order-level manual inventory adjustment. */
  @Put('order-adjustment')
  saveOrderAdjustment(
    @CurrentTenant() tenantId: string,
    @Body() dto: SaveOrderAdjustmentDto,
  ) {
    return this.service.saveOrderAdjustment(
      tenantId,
      dto.orderId,
      dto.lines,
      dto.reason,
      dto.note,
    );
  }

  /** Test-level manual adjustment view for one of the order's lab tests. */
  @Get('test-adjustment')
  loadTestAdjustment(
    @CurrentTenant() tenantId: string,
    @Query('orderId') orderId: string,
    @Query('labReportId') labReportId: string,
  ) {
    return this.service.loadTestAdjustment(tenantId, orderId, labReportId);
  }

  /** Apply a test-level manual inventory adjustment for one of the order's tests. */
  @Put('test-adjustment')
  saveTestAdjustment(
    @CurrentTenant() tenantId: string,
    @Body() dto: SaveTestAdjustmentDto,
  ) {
    return this.service.saveTestAdjustment(
      tenantId,
      dto.orderId,
      dto.labReportId,
      dto.lines,
      dto.reason,
      dto.note,
    );
  }
}
