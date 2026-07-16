import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Branch-admin dashboard aggregate endpoints. Business-authenticated; tenant
 * comes from the JWT and branch from the caller's active profile (no
 * client-supplied `branchId` — branch-admin is implicitly single-branch).
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('branch-admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
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
  ) {
    return this.dashboardService.getMasterDataSummary(
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Referral panels in the caller's branch, grouped by payment type. */
  @Get('referral-panels-summary')
  getReferralPanelsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.dashboardService.getReferralPanelsSummary(
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Active vs. inactive referral doctors in the caller's branch. */
  @Get('referral-doctors-summary')
  getReferralDoctorsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.dashboardService.getReferralDoctorsSummary(
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Active vs. inactive external referrals in the caller's branch. */
  @Get('external-referrals-summary')
  getExternalReferralsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.dashboardService.getExternalReferralsSummary(
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Active vs. inactive internal referrals in the caller's branch. */
  @Get('internal-referrals-summary')
  getInternalReferralsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.dashboardService.getInternalReferralsSummary(
      tenantId,
      this.requireBranch(profile),
    );
  }
}
