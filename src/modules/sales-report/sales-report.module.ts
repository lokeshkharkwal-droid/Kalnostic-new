import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesTripModule } from '../sales-trip/sales-trip.module';
import { SalesReportController } from './sales-report.controller';
import { SalesReportService } from './sales-report.service';

/**
 * Read-only sales reporting module (Lead-wise + Salesperson-wise). Imports
 * `SalesTripModule` for the shared `SalesStaffService` (salesperson name
 * resolution).
 */
@Module({
  imports: [PrismaModule, SalesTripModule],
  controllers: [SalesReportController],
  providers: [SalesReportService],
  exports: [SalesReportService],
})
export class SalesReportModule {}
