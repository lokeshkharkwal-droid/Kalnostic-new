import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesTripModule } from '../sales-trip/sales-trip.module';
import { SalesTerritoryModule } from '../sales-territory/sales-territory.module';
import { SalesFollowUpModule } from '../sales-follow-up/sales-follow-up.module';
import { SalesLeadController } from './sales-lead.controller';
import { SalesLeadService } from './sales-lead.service';

/**
 * Business-lead module. Imports the trip module (for `SalesStaffService` +
 * `SalesTripService` — the "Start Trip" flow), the territory module (to
 * validate a lead's `territoryId`), and the follow-up module (to auto-create a
 * follow-up when a meeting outcome routes the lead to FOLLOW_UP_REQUIRED).
 * Exports `SalesLeadService`.
 */
@Module({
  imports: [
    PrismaModule,
    SalesTripModule,
    SalesTerritoryModule,
    SalesFollowUpModule,
  ],
  controllers: [SalesLeadController],
  providers: [SalesLeadService],
  exports: [SalesLeadService],
})
export class SalesLeadModule {}
