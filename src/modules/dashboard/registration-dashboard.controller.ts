import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { BranchService } from '../branch/branch.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';
import { BranchScopeDeniedException } from './exceptions/dashboard.exceptions';
import { BranchAdminDashboardQueryDto } from './dto/branch-admin-dashboard-query.dto';
import { RegistrationOrdersQueryDto } from './dto/registration-orders-query.dto';
import { RegistrationBillingsQueryDto } from './dto/registration-billings-query.dto';
import { RegistrationPaymentStatusQueryDto } from './dto/registration-payment-status-query.dto';
import { RegistrationUserFilterQueryDto } from './dto/registration-user-filter-query.dto';
import { RegistrationCollectionsQueryDto } from './dto/registration-collections-query.dto';
import { RegistrationOutstandingsQueryDto } from './dto/registration-outstandings-query.dto';
import { RegistrationCanceledQueryDto } from './dto/registration-canceled-query.dto';
import { RegistrationRefundsQueryDto } from './dto/registration-refunds-query.dto';
import { RegistrationAppointmentsStatusQueryDto } from './dto/registration-appointments-status-query.dto';

const REGISTRATION_MODULE_KEY = 'registration';

/**
 * Registration dashboard aggregate endpoints. Business-authenticated; tenant
 * comes from the JWT.
 *
 * Branch scope has two shapes, resolved by {@link resolveBranchScope}:
 * - A normal (branch-scoped) profile is always locked to their own branch —
 *   `branchId` defaults to it when omitted, and any mismatched explicit value
 *   is rejected (`BranchScopeDeniedException`). Unchanged from before this
 *   dashboard supported Business Admin.
 * - A `business_admin` profile (tenant-level, no branch of their own) gets a
 *   real branch selector: omitting `branchId` (or passing `"all"`) aggregates
 *   across every branch where they actually have Registration access (never
 *   every tenant branch — see `BranchService.getAccessibleBranchIds`); an
 *   explicit branch id is validated against that same accessible set, not
 *   just "does this branch exist."
 *
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('registration/dashboard')
export class RegistrationDashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Resolve the effective branch scope for this request — either a single
   * `branchId` or a `branchIds` set to aggregate across (Business Admin's
   * "All Branches" view). Exactly one of the two is ever set.
   * @throws ActiveBranchRequiredException if a normal profile has no active branch
   * @throws BranchScopeDeniedException if `branchId` doesn't match the caller's own branch (normal profile), or isn't one of the business_admin's Registration-accessible branches
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
        REGISTRATION_MODULE_KEY,
      );
      if (!requestedBranchId || requestedBranchId === 'all') {
        return { branchIds: accessibleIds };
      }
      if (!accessibleIds.includes(requestedBranchId)) {
        throw new BranchScopeDeniedException(requestedBranchId, '');
      }
      return { branchId: requestedBranchId };
    }

    // Normal profile: unchanged — always own branch, reject any mismatch.
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    if (requestedBranchId && requestedBranchId !== profile.branchId) {
      throw new BranchScopeDeniedException(requestedBranchId, profile.branchId);
    }
    return { branchId: profile.branchId };
  }

  /** Normalizes a resolved scope to whatever `DashboardService` methods expect (`string | string[] | undefined`). */
  private scopeToBranchId(
    scope: { branchId?: string; branchIds?: string[] },
  ): string | string[] | undefined {
    return scope.branchId ?? scope.branchIds;
  }

  /**
   * Users with Registration module access at the caller's branch, for the
   * dashboard's User Filter dropdowns (Quotations/Billings/Collections/
   * Outstandings/Canceled/Refunds/Payment Status).
   */
  @Get('registration-users')
  async getRegistrationUsers(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: BranchAdminDashboardQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    return this.dashboardService.getRegistrationUsers(
      tenantId,
      this.scopeToBranchId(scope) ?? [],
    );
  }

  /**
   * Orders in the caller's branch, grouped by module (Diagnostics/OPD/
   * Radiology/Pharmacy/IPD). `dateMode` selects Today/Backdated/Advanced
   * Dated (relative to `orderDate`); defaults to Today when omitted.
   */
  @Get('orders-summary')
  async getOrdersSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationOrdersQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    return this.dashboardService.getOrdersSummary(
      tenantId,
      this.scopeToBranchId(scope),
      query.dateMode,
    );
  }

  /**
   * Billings breakdown (Gross/Discount/Net/Paid Online/Paid Cash/Balance/
   * Canceled/TDS) in the caller's branch. `dateMode`/`module` scope which
   * orders' payments are summed; both default when omitted.
   */
  @Get('billings-summary')
  async getBillingsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationBillingsQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    return this.dashboardService.getBillingsSummary(
      tenantId,
      this.scopeToBranchId(scope),
      query.dateMode,
      query.module,
      query.createdBy,
    );
  }

  /**
   * Cancellation-charge amounts retained by the lab in the caller's branch.
   * Two views, selected by `view`:
   * - `'user-wise'` (default): "All Users" (`cancelledBy` omitted) shows the
   *   Top 5 individual cancellation charges across every canceller; a
   *   specific `cancelledBy` shows ALL of that one user's own cancellations
   *   (no top-5 cap). Each due is tagged with the patient and whoever
   *   CANCELLED the order (not who created it).
   * - `'b2b'`: same shape, but scoped to orders with a referral panel.
   *   "All B2B" (`referralPanelId` omitted) shows the Top 5 across every
   *   panel-linked cancellation; a specific panel shows ALL of that panel's
   *   own cancellations (no top-5 cap).
   * Whether the cancellation included a refund is irrelevant — not split by
   * refund/no-refund. No date filter — all-time.
   */
  @Get('canceled-summary')
  async getCanceledSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationCanceledQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    if (query.view === 'b2b') {
      return this.dashboardService.getTopCancellationChargesByPanel(
        tenantId,
        this.scopeToBranchId(scope),
        query.referralPanelId,
      );
    }
    return this.dashboardService.getTopCancellationCharges(
      tenantId,
      this.scopeToBranchId(scope),
      query.cancelledBy,
    );
  }

  /**
   * Outstanding-balance amounts in the caller's branch (non-cancelled,
   * not-fully-paid orders). Two views, selected by `view`:
   * - `'b2b'`: grouped by B2B referral panel (unmapped orders fold into
   *   "Others"); a specific `referralPanelId` narrows to just that panel's
   *   own total.
   * - `'user-wise'` (default): "All Users" (`createdBy` omitted) shows the
   *   Top 5 individual outstanding dues across every Registration user at
   *   the branch; a specific `createdBy` shows ALL of that one user's own
   *   outstanding orders (no top-5 cap). Each due is tagged with whoever
   *   created that order.
   * No date filter — all-time.
   */
  @Get('outstandings-summary')
  async getOutstandingsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationOutstandingsQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    if (query.view !== 'b2b') {
      return this.dashboardService.getTopOutstandingDues(
        tenantId,
        this.scopeToBranchId(scope),
        query.createdBy,
      );
    }
    return this.dashboardService.getOutstandingsSummary(
      tenantId,
      this.scopeToBranchId(scope),
      query.createdBy,
      query.referralPanelId,
    );
  }

  /**
   * Refund amounts in the caller's branch. Two views, selected by `view`:
   * - `'user-wise'` (default): "All Users" (`createdBy` omitted) shows the
   *   Top 5 individual refunds across every order creator; a specific
   *   `createdBy` shows the Top 5 refunds among orders THAT user created
   *   (still capped at 5 — no reliable "who processed this refund" actor
   *   exists, so refunds are tagged by order creator, not processor).
   * - `'b2b'`: same shape, scoped to orders with a referral panel. "All
   *   B2B" (`referralPanelId` omitted) shows the Top 5 across every
   *   panel-linked refund; a specific panel shows the Top 5 among that
   *   panel's own refunds.
   * Each entry is ONE `PaymentDetails` REFUND row — an order refunded twice
   * produces two separate entries. No date filter — all-time.
   */
  @Get('refunds-summary')
  async getRefundsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationRefundsQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    if (query.view === 'b2b') {
      return this.dashboardService.getTopRefundsByPanel(
        tenantId,
        this.scopeToBranchId(scope),
        query.referralPanelId,
      );
    }
    return this.dashboardService.getTopRefunds(
      tenantId,
      this.scopeToBranchId(scope),
      query.createdBy,
    );
  }

  /**
   * New/Previous/Total patients (each split Male/Female/Total) in the
   * caller's branch. `dateMode` selects Today/Backdated/Advanced Dated
   * (relative to `orderDate`); defaults to Today when omitted.
   */
  @Get('patients-summary')
  async getPatientsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationOrdersQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    return this.dashboardService.getPatientsSummary(
      tenantId,
      this.scopeToBranchId(scope),
      query.dateMode,
    );
  }

  /**
   * Appointments in the caller's branch, grouped by status. `module` selects
   * which bucket: `'diagnostic'` (default) vs. `'phlebotomist'` — both drawn
   * from the same DIAGNOSTIC appointment type, split by whether the order's
   * diagnostics section has home visit on; `'consultant'`/`'radiologist'`
   * are disabled placeholders for now (always all-zero).
   */
  @Get('appointments-status-summary')
  async getAppointmentsStatusSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationAppointmentsStatusQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    return this.dashboardService.getAppointmentsStatusSummary(
      tenantId,
      this.scopeToBranchId(scope),
      query.module,
    );
  }

  /** Quotations in the caller's branch, grouped into Draft/Converted/Expired. */
  @Get('quotations-summary')
  async getQuotationsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationUserFilterQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    return this.dashboardService.getQuotationsSummary(
      tenantId,
      this.scopeToBranchId(scope) ?? [],
      query.createdBy,
    );
  }

  /**
   * Payment-status breakdown (Pending/Partially Pending/Paid/Canceled) in
   * the caller's branch, summed by `netAmount`. `module` scopes Diagnostics/
   * OPD/Radiology/Pharmacy/IPD/All; defaults to All when omitted. No date
   * filter — all-time.
   */
  @Get('payment-status-summary')
  async getPaymentStatusSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationPaymentStatusQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    return this.dashboardService.getPaymentStatusSummary(
      tenantId,
      this.scopeToBranchId(scope),
      query.module,
      query.createdBy,
      query.referralPanelId,
    );
  }

  /**
   * Gross/Discount/Net/Paid/Balance breakdown for appointment-linked orders
   * only, in the caller's branch. No date filter — all-time. `module`
   * selects which bucket, same convention as `appointments-status-summary`:
   * `'diagnostic'` (default) vs. `'phlebotomist'` — both DIAGNOSTIC
   * appointments split by home-visit; `'consultant'`/`'radiologist'` are
   * disabled placeholders for now (always all-zero).
   */
  @Get('appointment-payment-status-summary')
  async getAppointmentPaymentStatusSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationAppointmentsStatusQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    return this.dashboardService.getAppointmentPaymentStatusSummary(
      tenantId,
      this.scopeToBranchId(scope),
      query.module,
    );
  }

  /**
   * Payment-mode breakdown (Cash/UPI/Card/Bank Transfer/Wallet Used/
   * Loyalty Point Used, plus 3 hardcoded-0 buckets — see
   * `docs/REGISTRATION-DASHBOARD-GAPS.md`) in the caller's branch.
   * `dateMode` selects Today/Backdated/Advanced Dated relative to
   * `PaymentDetails.paymentDate` (when the payment happened, not when the
   * order was created — falls back to `createdAt` for older null rows);
   * defaults to Today when omitted. No module filter.
   */
  @Get('collections-summary')
  async getCollectionsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: RegistrationCollectionsQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    return this.dashboardService.getCollectionsSummary(
      tenantId,
      this.scopeToBranchId(scope),
      query.createdBy,
      query.dateMode,
    );
  }

  /** Active vs. inactive headcount for Doctors, Phlebotomists, Radiologists. */
  @Get('staff-availability-summary')
  async getStaffAvailabilitySummary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Query() query: BranchAdminDashboardQueryDto,
  ) {
    const scope = await this.resolveBranchScope(tenantId, profile, personId, query.branchId);
    return this.dashboardService.getStaffAvailabilitySummary(
      tenantId,
      this.scopeToBranchId(scope),
    );
  }
}
