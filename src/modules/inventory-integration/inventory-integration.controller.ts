import { Controller, Get, Query } from '@nestjs/common';
import { InventoryConsumptionService } from './inventory-consumption.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';

/**
 * Registration-facing inventory integration. The tooltip on `/registration/create`
 * calls this to learn whether a selected branch lab test is mapped to a proforma
 * at the active branch, and (if so) its products' live stock + alert levels. Tenant
 * + active branch come from the JWT; the frontend only passes the branch lab test.
 */
@Controller('inventory')
export class InventoryIntegrationController {
  constructor(private readonly service: InventoryConsumptionService) {}

  /** Proforma + product/stock info for a selected branch lab test (tooltip). */
  @Get('proforma-info')
  proformaInfo(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query('branchLabTestId') branchLabTestId: string,
  ) {
    return this.service.proformaInfo(tenantId, profile.branchId, branchLabTestId);
  }
}
