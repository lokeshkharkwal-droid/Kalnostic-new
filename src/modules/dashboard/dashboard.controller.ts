import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';
import { BranchScopeDeniedException } from './exceptions/dashboard.exceptions';
import { BranchAdminDashboardQueryDto } from './dto/branch-admin-dashboard-query.dto';

/**
 * Branch-admin dashboard aggregate endpoints. Business-authenticated; tenant
 * comes from the JWT. `branchId` is read from the query string like every
 * other dashboard endpoint (see `BusinessAdminDashboardController`) — never
 * taken directly off the JWT — but is validated against the caller's active
 * profile: branch-admin may only ever see their own branch, so a mismatched
 * `branchId` is rejected rather than silently honoured, and an omitted one
 * defaults to the caller's own branch. The global `JwtAuthGuard` protects all
 * routes.
 */
@Controller('branch-admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Resolve the effective branch for this request: the query param if
   * supplied (validated to match the caller's own branch), otherwise the
   * caller's active branch from their JWT profile.
   * @throws ActiveBranchRequiredException if the caller has no active branch
   * @throws BranchScopeDeniedException if `branchId` was supplied and doesn't match the caller's own branch
   */
  private resolveBranch(profile: ActiveProfile, requestedBranchId?: string): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    if (requestedBranchId && requestedBranchId !== profile.branchId) {
      throw new BranchScopeDeniedException(requestedBranchId, profile.branchId);
    }
    return profile.branchId;
  }

  /**
   * Active lab tests in the caller's branch, grouped by department, for the
   * "Master Data - Total Tests" donut.
   */
  @Get('master-data-summary')
  getMasterDataSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getMasterDataSummary(
      tenantId,
      this.resolveBranch(profile, query.branchId),
    );
  }

  /** Referral panels in the caller's branch, grouped by payment type. */
  @Get('referral-panels-summary')
  getReferralPanelsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getReferralPanelsSummary(
      tenantId,
      this.resolveBranch(profile, query.branchId),
    );
  }

  /** Active vs. inactive referral doctors in the caller's branch. */
  @Get('referral-doctors-summary')
  getReferralDoctorsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getReferralDoctorsSummary(
      tenantId,
      this.resolveBranch(profile, query.branchId),
    );
  }

  /** Active vs. inactive external referrals in the caller's branch. */
  @Get('external-referrals-summary')
  getExternalReferralsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getExternalReferralsSummary(
      tenantId,
      this.resolveBranch(profile, query.branchId),
    );
  }

  /** Active vs. inactive internal referrals in the caller's branch. */
  @Get('internal-referrals-summary')
  getInternalReferralsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getInternalReferralsSummary(
      tenantId,
      this.resolveBranch(profile, query.branchId),
    );
  }
}
