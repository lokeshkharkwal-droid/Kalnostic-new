import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RegistrationSettingsModule } from '../registration-settings/registration-settings.module';
import { BranchModule } from '../branch/branch.module';
import { DashboardController } from './dashboard.controller';
import { BusinessAdminDashboardController } from './business-admin-dashboard.controller';
import { RegistrationDashboardController } from './registration-dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Branch-admin, business-admin, and registration dashboard aggregate
 * endpoints (donut/bar/table read-models). All three controllers share one
 * `DashboardService` — the queries are identical, only how each derives
 * `branchId` differs (forced from the JWT for branch-admin/registration,
 * optional client-supplied for business-admin). `RegistrationSettingsModule`
 * is needed for the Quotations summary's per-branch validity window.
 * `BranchModule` (for `BranchService`) is needed by
 * `RegistrationDashboardController`'s `resolveBranchScope` — resolving a
 * Business Admin's accessible-branch set for Registration.
 */
@Module({
  imports: [PrismaModule, RegistrationSettingsModule, BranchModule],
  controllers: [
    DashboardController,
    BusinessAdminDashboardController,
    RegistrationDashboardController,
  ],
  providers: [DashboardService],
})
export class DashboardModule {}
