import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { InventorySettingsModule } from '../inventory-settings/inventory-settings.module';
import { InventoryConsumptionClient } from './inventory-consumption.client';
import { InventoryConsumptionService } from './inventory-consumption.service';
import { InventoryIntegrationController } from './inventory-integration.controller';

/**
 * Inventory integration module — the single seam kalnostics-new uses to call the
 * inventory service (proforma-driven consumption + registration proforma info).
 * Global so the order flow can inject {@link InventoryConsumptionService} without
 * re-importing. Safe no-op when `INVENTORY_API_BASE_URL` is unset.
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule, InventorySettingsModule],
  controllers: [InventoryIntegrationController],
  providers: [InventoryConsumptionClient, InventoryConsumptionService],
  exports: [InventoryConsumptionService],
})
export class InventoryIntegrationModule {}
