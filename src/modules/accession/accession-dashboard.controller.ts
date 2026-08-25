import { Controller, Get, Query } from '@nestjs/common';
import { AccessionDashboardService } from './accession-dashboard.service';
import { BranchService } from '../branch/branch.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';
import { BranchScopeDeniedException } from '../dashboard/exceptions/dashboard.exceptions';
import { AccessionDashboardQueryDto } from './dto/accession-dashboard-query.dto';

const ACCESSION_MODULE_KEY = 'accession';

/**
 * Accession dashboard aggregate endpoints (`/accession/dashboard`).
 * Business-authenticated; tenant comes from the JWT.
 *
 * Branch scope is resolved by {@link resolveBranchScope}, mirroring the
 * Registration dashboard's contract exactly:
 * - A normal (branch-scoped) profile is ALWAYS locked to their own branch —
 *   any explicit `branchId` is ignored/rejected, never honoured. This closes
 *   a real gap: before this change, `branchId` was client-supplied with no
 *   ownership check at all, so any authenticated Accession user could pass
 *   another branch's id (or omit it for a tenant-wide aggregate) and the
 *   server complied.
 * - A `business_admin` profile gets a real branch selector: omitting
 *   `branchId` (or passing `"all"`) aggregates across every branch where
 *   they have Accession access (never every tenant branch); an explicit id
 *   is validated against that same accessible set.
 *
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('accession/dashboard')
export class AccessionDashboardController {
  constructor(
    private readonly dashboardService: AccessionDashboardService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Resolve the effective branch scope for this request — either a single
   * `branchId` or a `branchIds` set to aggregate across (Business Admin's
   * "All Branches" view). Exactly one of the two is ever set. Mirrors
   * `RegistrationDashboardController.resolveBranchScope`.
   * @throws ActiveBranchRequiredException if a normal profile has no active branch
   * @throws BranchScopeDeniedException if `branchId` doesn't match the caller's own branch (normal profile), or isn't one of the business_admin's Accession-accessible branches
   */
  private async resolveBranchScope(
    tenantId: string,
    profile: ActiveProfile,
    personId: string,
    requestedBranchId?: string,
  ): Promise<{ branchId?: string; branchIds?: string[] }> {
    if (profile.profileKey === 'business_admin') {
      const accessibleIds = await this.branchService.getAccessibleBranchIds(
        tenantId,
        personId,
        ACCESSION_MODULE_KEY,
      );
      if (!requestedBranchId || requestedBranchId === 'all') {
        return { branchIds: accessibleIds };
      }
      if (!accessibleIds.includes(requestedBranchId)) {
        throw new BranchScopeDeniedException(requestedBranchId, '');
      }
      return { branchId: requestedBranchId };
    }

    // Normal profile: always own branch, reject any mismatch — this is the
    // real ownership check this controller never had before.
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    if (requestedBranchId && requestedBranchId !== profile.branchId) {
      throw new BranchScopeDeniedException(requestedBranchId, profile.branchId);
    }
    return { branchId: profile.branchId };
  }

  /** Normalizes a resolved scope to whatever `AccessionDashboardService` methods expect (`string | string[] | undefined`). */
  private scopeToBranchId(scope: {
    branchId?: string;
    branchIds?: string[];
  }): string | string[] | undefined {
    return scope.branchId ?? scope.branchIds;
  }

  /**
   * Top-of-page stat cards: Total Samples, In-House, Internal Referral,
   * External Referral, Outsourced — each with a %-change vs. yesterday.
   */
  @Get('stats-summary')
  async getStatsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: AccessionDashboardQueryDto,
  ) {
    const scope = await this.resolveBranchScope(
      tenantId,
      profile,
      personId,
      query.branchId,
    );
    return this.dashboardService.getStatsSummary(
      tenantId,
      this.scopeToBranchId(scope),
    );
  }

  /**
   * In-house order status overview: a count per sample status (New,
   * Collected, Accepted, ..., Outsourced).
   */
  @Get('order-status-overview')
  async getOrderStatusOverview(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: AccessionDashboardQueryDto,
  ) {
    const scope = await this.resolveBranchScope(
      tenantId,
      profile,
      personId,
      query.branchId,
    );
    return this.dashboardService.getOrderStatusOverview(
      tenantId,
      this.scopeToBranchId(scope),
    );
  }

  /**
   * TAT compliance donut: a count per TAT band (Within TAT / Warning /
   * Breach (Imminent) / Breached).
   */
  @Get('tat-compliance')
  async getTatCompliance(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: AccessionDashboardQueryDto,
  ) {
    const scope = await this.resolveBranchScope(
      tenantId,
      profile,
      personId,
      query.branchId,
    );
    return this.dashboardService.getTatCompliance(
      tenantId,
      this.scopeToBranchId(scope),
    );
  }

  /**
   * Critical alerts: TAT Breached, Samples On Hold, Repeat Samples, Rejected
   * Samples. The header's date-range filter (`dateFrom`/`dateTo`) applies
   * ONLY to Rejected Samples — the other 3 are live snapshots and always
   * ignore it.
   */
  @Get('critical-alerts')
  async getCriticalAlerts(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: AccessionDashboardQueryDto,
  ) {
    const scope = await this.resolveBranchScope(
      tenantId,
      profile,
      personId,
      query.branchId,
    );
    return this.dashboardService.getCriticalAlerts(
      tenantId,
      this.scopeToBranchId(scope),
      query.dateFrom,
      query.dateTo,
    );
  }

  /**
   * Internal Referral Orders — Sent (to internal centers) vs. Received
   * (from internal centers), one bar per branch. Takes the header's
   * date-range filter.
   */
  @Get('internal-referral-orders')
  async getInternalReferralOrders(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: AccessionDashboardQueryDto,
  ) {
    const scope = await this.resolveBranchScope(
      tenantId,
      profile,
      personId,
      query.branchId,
    );
    return this.dashboardService.getInternalReferralOrders(
      tenantId,
      this.scopeToBranchId(scope),
      query.dateFrom,
      query.dateTo,
    );
  }

  /**
   * External Referral Orders — Sent (to external partner labs) only; the
   * receiving side has no backing today (cross-tenant, not built). Takes
   * the header's date-range filter.
   */
  @Get('external-referral-orders-sent')
  async getExternalReferralOrdersSent(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: AccessionDashboardQueryDto,
  ) {
    const scope = await this.resolveBranchScope(
      tenantId,
      profile,
      personId,
      query.branchId,
    );
    return this.dashboardService.getExternalReferralOrdersSent(
      tenantId,
      this.scopeToBranchId(scope),
      query.dateFrom,
      query.dateTo,
    );
  }

  /**
   * Outsource Orders: a donut of samples sent to outsource centers. Takes
   * the header's date-range filter.
   */
  @Get('outsource-orders')
  async getOutsourceOrders(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: AccessionDashboardQueryDto,
  ) {
    const scope = await this.resolveBranchScope(
      tenantId,
      profile,
      personId,
      query.branchId,
    );
    return this.dashboardService.getOutsourceOrders(
      tenantId,
      this.scopeToBranchId(scope),
      query.dateFrom,
      query.dateTo,
    );
  }
}
