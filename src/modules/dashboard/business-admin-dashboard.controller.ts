import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { BusinessAdminDashboardQueryDto } from './dto/business-admin-dashboard-query.dto';

/**
 * Business-admin dashboard aggregate endpoints. Business-authenticated;
 * tenant comes from the JWT. Business-admin has no branch of its own (it's a
 * tenant-wide, multi-branch view — CLAUDE.md's "no branch = unrestricted"
 * profile), so `branchId` is client-supplied and optional: omitted (the
 * dashboard's "All Branches" filter option) aggregates across every branch in
 * the tenant; a real id scopes to just that one branch. The global
 * `JwtAuthGuard` protects all routes.
 */
@Controller('business-admin/dashboard')
export class BusinessAdminDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Org-wide Total Branches / Active Users stat row. Tenant-wide only — no
   * `branchId` param, since this row has no branch filter in the UI. Does
   * take the header's `dateFrom`/`dateTo` — omitted returns current totals,
   * set scopes both counts to rows created in that range.
   */
  @Get('stats-summary')
  getStatsSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: BusinessAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getStatsSummary(
      tenantId,
      query.dateFrom,
      query.dateTo,
    );
  }

  /**
   * Active lab tests, grouped by department, for the "Master Data - Total
   * Tests" donut.
   */
  @Get('master-data-summary')
  getMasterDataSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: BusinessAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getMasterDataSummary(
      tenantId,
      query.branchId,
      query.dateFrom,
      query.dateTo,
    );
  }

  /** Referral panels, grouped by payment type. */
  @Get('referral-panels-summary')
  getReferralPanelsSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: BusinessAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getReferralPanelsSummary(
      tenantId,
      query.branchId,
      query.dateFrom,
      query.dateTo,
    );
  }

  /** Active vs. inactive referral doctors. */
  @Get('referral-doctors-summary')
  getReferralDoctorsSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: BusinessAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getReferralDoctorsSummary(
      tenantId,
      query.branchId,
      query.dateFrom,
      query.dateTo,
    );
  }

  /** Active vs. inactive external referrals. */
  @Get('external-referrals-summary')
  getExternalReferralsSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: BusinessAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getExternalReferralsSummary(
      tenantId,
      query.branchId,
      query.dateFrom,
      query.dateTo,
    );
  }

  /** Active vs. inactive internal referrals. */
  @Get('internal-referrals-summary')
  getInternalReferralsSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: BusinessAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getInternalReferralsSummary(
      tenantId,
      query.branchId,
      query.dateFrom,
      query.dateTo,
    );
  }

  /** Active staff headcount, grouped by role. */
  @Get('users-by-role-summary')
  getUsersByRoleSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: BusinessAdminDashboardQueryDto,
  ) {
    return this.dashboardService.getUsersByRoleSummary(
      tenantId,
      query.branchId,
      query.dateFrom,
      query.dateTo,
    );
  }

  /**
   * Weekly open/closed schedule with per-shift timing for one specific
   * branch's currently-ACTIVE schedule. Unlike every other endpoint here, a
   * schedule is inherently branch-specific — there's no tenant-wide
   * aggregate — so an omitted `branchId` ("All Branches") returns an empty
   * array rather than calling through with `undefined`.
   */
  @Get('schedule-plan-summary')
  getSchedulePlanSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: BusinessAdminDashboardQueryDto,
  ) {
    if (!query.branchId) {
      return [];
    }
    return this.dashboardService.getSchedulePlanSummary(
      tenantId,
      query.branchId,
    );
  }
}
