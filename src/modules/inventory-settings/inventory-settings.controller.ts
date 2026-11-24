import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { InventorySettingsService } from './inventory-settings.service';
import { SaveInventorySettingsDto } from './dto/save-inventory-settings.dto';

/**
 * Business Admin › Business Settings › Inventory Settings. Business-authenticated;
 * tenant comes from the JWT (never a body). Reads are left ungated so the
 * Technician Reporting page can learn which manual-adjustment action to show.
 *
 * NOTE: the write-permission gate is temporarily removed — any authenticated
 * business user may save. Re-add `@UseGuards(PermissionGuard)` on the controller
 * and `@RequirePermission(PERMISSION_KEYS.BA_INVENTORY_SETTINGS_UPDATE)` on the
 * PUT (plus their imports) when route-level RBAC is wired up.
 */
@Controller('inventory-settings')
export class InventorySettingsController {
  constructor(private readonly service: InventorySettingsService) {}

  /**
   * The tenant's Inventory Settings. Readable by any authenticated business user
   * (the technician UI needs `manualAdjustmentMode`); not sensitive.
   */
  @Get()
  get(@CurrentTenant() tenantId: string) {
    return this.service.get(tenantId);
  }

  /** Save the tenant's Inventory Settings (permission gate temporarily removed). */
  @Put()
  @Audit({
    module: AuditModule.INVENTORY_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated inventory settings',
  })
  save(
    @CurrentTenant() tenantId: string,
    @Body() dto: SaveInventorySettingsDto,
  ) {
    return this.service.save(tenantId, dto);
  }
}
