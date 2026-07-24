import { Controller, Get } from '@nestjs/common';
import { SalesDashboardService } from './sales-dashboard.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { ActiveBranchRequiredException } from './exceptions/sales-dashboard.exceptions';

/**
 * Sales dashboard endpoint (business-authenticated; tenant + active branch come
 * from the JWT). Powers the Sales → Dashboard overview. Read-only.
 */
@Controller('sales/dashboard')
export class SalesDashboardController {
  constructor(private readonly dashboardService: SalesDashboardService) {}

  /** Ensure the caller has an active branch, or throw. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** Composed dashboard overview for the active branch. */
  @Get()
  overview(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.dashboardService.overview(
      tenantId,
      this.requireBranch(profile),
    );
  }
}
