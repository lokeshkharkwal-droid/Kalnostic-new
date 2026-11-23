import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { InventorySettingsController } from './inventory-settings.controller';
import { InventorySettingsService } from './inventory-settings.service';

/**
 * Business Admin › Business Settings › Inventory Settings module. Tenant-scoped +
 * tenant-level. Exports {@link InventorySettingsService} so the order-creation
 * flow can read `isAutomaticInventoryReductionEnabled` / `manualAdjustmentMode`
 * to decide whether (and how) to auto-deduct inventory. `PermissionsModule`
 * provides the write guard; `PrismaModule` owns the `inventory_settings` table.
 */
@Module({
  imports: [PrismaModule, PermissionsModule],
  controllers: [InventorySettingsController],
  providers: [InventorySettingsService],
  exports: [InventorySettingsService],
})
export class InventorySettingsModule {}
