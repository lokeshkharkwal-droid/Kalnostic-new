import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DashboardController } from './dashboard.controller';
import { BusinessAdminDashboardController } from './business-admin-dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Branch-admin and business-admin dashboard aggregate endpoints (donut/bar/
 * table read-models). Both controllers share one `DashboardService` — the
 * queries are identical, only how each derives `branchId` differs (forced
 * from the JWT for branch-admin, optional client-supplied for business-admin).
 */
@Module({
  imports: [PrismaModule],
  controllers: [DashboardController, BusinessAdminDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
