import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { OrderModule } from '../order/order.module';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';

/**
 * Finance Invoice feature module. Tenant-scoped + branch-level. Imports
 * `OrderModule` to reuse `OrderService.getOutstandingInfoForOrders` (rule #3 DI) so
 * an invoice's gross amount is derived from the same logic as the Outstanding
 * report. Invoice numbers are drawn from the tenant's `BillingSetting`.
 */
@Module({
  imports: [PrismaModule, PermissionsModule, OrderModule],
  controllers: [InvoiceController],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class InvoiceModule {}
