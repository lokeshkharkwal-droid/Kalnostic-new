import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesTripController } from './sales-trip.controller';
import { SalesTripService } from './sales-trip.service';
import { SalesStaffService } from './sales-staff.service';
import { SalesLeadStatusService } from './sales-lead-status.service';

/**
 * Field-sales trip module. Also acts as the shared sales hub: it hosts
 * `SalesStaffService` (salesperson validation + name resolution) and
 * `SalesLeadStatusService` (the single lead status + history writer) so the lead
 * and follow-up modules can inject them without a circular dependency. Exports
 * `SalesTripService` (the lead module's "Start Trip" flow creates a linked trip),
 * `SalesStaffService`, and `SalesLeadStatusService`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SalesTripController],
  providers: [SalesTripService, SalesStaffService, SalesLeadStatusService],
  exports: [SalesTripService, SalesStaffService, SalesLeadStatusService],
})
export class SalesTripModule {}
