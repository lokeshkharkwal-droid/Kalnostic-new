import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesTripModule } from '../sales-trip/sales-trip.module';
import { SalesFollowUpController } from './sales-follow-up.controller';
import { SalesFollowUpService } from './sales-follow-up.service';

/**
 * Sales follow-up module. Tenant-scoped + branch-level follow-up queue hanging
 * off leads. Imports `SalesTripModule` for the shared `SalesStaffService`
 * (salesperson validation + name resolution) and validates linked trips.
 */
@Module({
  imports: [PrismaModule, SalesTripModule],
  controllers: [SalesFollowUpController],
  providers: [SalesFollowUpService],
  exports: [SalesFollowUpService],
})
export class SalesFollowUpModule {}
