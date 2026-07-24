import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesTripModule } from '../sales-trip/sales-trip.module';
import { SalesDashboardController } from './sales-dashboard.controller';
import { SalesDashboardService } from './sales-dashboard.service';

/**
 * Sales dashboard module (branch-level overview). Imports `SalesTripModule` for
 * the shared `SalesStaffService` (top-performer name resolution).
 */
@Module({
  imports: [PrismaModule, SalesTripModule],
  controllers: [SalesDashboardController],
  providers: [SalesDashboardService],
  exports: [SalesDashboardService],
})
export class SalesDashboardModule {}
