import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { OrderModule } from '../order/order.module';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

/**
 * Finance Settlement feature module. Tenant-scoped + branch-level. Imports
 * `OrderModule` to reuse `OrderService.getCollectionInfoForPayments` /
 * `getReservedForPayments` (rule #3 DI) so a settlement's per-payment collected
 * basis matches the Collection report. Settlement numbers come from `BillingSetting`.
 */
@Module({
  imports: [PrismaModule, PermissionsModule, OrderModule],
  controllers: [SettlementController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
