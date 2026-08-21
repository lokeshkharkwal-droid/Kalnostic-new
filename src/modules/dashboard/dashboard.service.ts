import { Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  DayOfWeek,
  QuotationStatus,
  ScheduleStatus,
  ShiftName,
  StaffStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RegistrationSettingsService } from '../registration-settings/registration-settings.service';
import { computeEffectivePaid } from '../order/entities/order.entity';
import { subtractInterval } from '../../common/utils/quotation-expiry.util';
import type { BillingsModule } from './dto/registration-billings-query.dto';
import {
  BillingsSummary,
  DashboardSlice,
  MasterDataSummarySlice,
  PatientBucket,
  PatientsSummary,
  RegistrationUserOption,
  ScheduleDayRow,
  StaffAvailabilitySlice,
} from './dto/master-data-summary.dto';

/** `AuthRole.key` values that identify a phlebotomist/radiologist staff Person
 * (mirrors `PHLEBOTOMIST_ROLE_KEYS`/`RADIOLOGIST_ROLE_KEYS` in
 * `users.service.ts` — neither role has its own master table; both are staff
 * `Person`s holding this role at a branch, per `UsersService`'s doc comments). */
const PHLEBOTOMIST_ROLE_KEYS = ['phlebotomist'];
const RADIOLOGIST_ROLE_KEYS = ['radiologist'];

/** The Registration dashboard's Orders/Billings/Collections "date mode" tab. */
export type OrderDateMode = 'today' | 'backdated' | 'advanced-dated';

/**
 * The Registration dashboard's "Appointments – Status" card module tab.
 * `'diagnostic'`/`'phlebotomist'` are both derived from the same
 * `AppointmentType.DIAGNOSTIC` value, split by `OrderDiagnostics.isHomeVisit`
 * — "Phlebotomist" is not a real `AppointmentType`. `'consultant'`/
 * `'radiologist'` are disabled placeholders for now (always all-zero).
 */
export type AppointmentsStatusModule =
  | 'diagnostic'
  | 'phlebotomist'
  | 'consultant'
  | 'radiologist';

/** One entry in the Outstandings card's "User-wise" Top-5 view — one order's live outstanding balance, tagged with its patient and creator. */
export interface TopOutstandingDue {
  orderId: string;
  patientName: string;
  createdByName: string;
  outstandingAmount: number;
}

/** One entry in the Cancellation card's Top-5 views (User-wise or B2B) — one order's cancellation charge, tagged with its patient and whoever cancelled it. */
export interface TopCancellationCharge {
  orderId: string;
  patientName: string;
  cancelledByName: string;
  cancellationChargeAmount: number;
}

/** One entry in the Refunds card's Top-5 views (User-wise or B2B) — one PaymentDetails REFUND row, tagged with its patient and the order's creator (no reliable "who processed this refund" actor exists on PaymentDetails). */
export interface TopRefund {
  orderId: string;
  patientName: string;
  createdByName: string;
  refundAmount: number;
}

/**
 * Business-admin dashboard's header date-range filter, applied to every
 * card's `createdAt`. Omitted (no range picked, the header's default) means
 * every card returns its normal current-state total; when both bounds are
 * set, counts are scoped to rows created within that range instead
 * (confirmed with the user). `dateTo` is treated as inclusive of the whole
 * day by advancing to the next day's start, matching Registration's
 * dateMode convention elsewhere in this file.
 */
function createdAtRange(
  dateFrom?: string,
  dateTo?: string,
): { gte: Date; lt: Date } | undefined {
  if (!dateFrom || !dateTo) return undefined;
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: start, lt: end };
}

/**
 * Builds the `branchId` clause for every dashboard aggregate's `where`.
 * `undefined`/omitted = no filter (aggregates across the whole tenant — the
 * business-admin/branch-admin "no branch picked" convention already used
 * throughout this file). A single string = exactly that branch (normal
 * single-branch users, or a Business Admin who picked one specific branch).
 * A string array = a Business Admin's "All Branches" aggregate, scoped to
 * only the branches they actually have module access to (never literally
 * every tenant branch) — resolved by the caller via
 * `BranchService.getAccessibleBranchIds` before reaching here.
 */
function branchWhere(
  branchId?: string | string[],
):
  | { branchId: string }
  | { branchId: { in: string[] } }
  | Record<string, never> {
  if (!branchId) return {};
  if (Array.isArray(branchId)) return { branchId: { in: branchId } };
  return { branchId };
}

/**
 * Aggregate read-models for the branch-admin dashboard. Every method here is a
 * `groupBy`/count rollup across a whole branch (not scoped to one master data
 * folder — `LabTest.masterDataId` is just an organisational grouping and is
 * unrelated to `LabTest.departmentId`), for the dashboard's donut/bar widgets.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrationSettingsService: RegistrationSettingsService,
  ) {}

  /**
   * Active lab tests, grouped by department. Departments are returned as they
   * actually exist for the tenant (no fixed label set) — a department with
   * zero active tests is omitted.
   * @param tenantId tenant scope
   * @param branchId branch scope; omitted (business-admin, "All Branches") aggregates across the whole tenant
   * @param dateFrom/dateTo header date-range filter; omitted counts all currently-active tests, set scopes to tests created in that range
   */
  async getMasterDataSummary(
    tenantId: string,
    branchId?: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<MasterDataSummarySlice[]> {
    const createdAt = createdAtRange(dateFrom, dateTo);
    const grouped = await this.prisma.labTest.groupBy({
      by: ['departmentId'],
      where: {
        tenantId,
        ...branchWhere(branchId),
        isActive: true,
        deletedAt: null,
        departmentId: { not: null },
        ...(createdAt && { createdAt }),
      },
      _count: { _all: true },
    });
    if (grouped.length === 0) {
      return [];
    }

    const departmentIds = grouped
      .map((g) => g.departmentId)
      .filter((id): id is string => Boolean(id));
    const departments = await this.prisma.department.findMany({
      where: { id: { in: departmentIds }, tenantId },
      select: { id: true, name: true },
    });
    const nameById = new Map(departments.map((d) => [d.id, d.name]));

    return grouped
      .filter((g) => nameById.has(g.departmentId!))
      .map((g) => ({
        label: nameById.get(g.departmentId!)!,
        value: g._count._all,
      }));
  }

  /**
   * Active vs. inactive referral doctors.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param dateFrom/dateTo header date-range filter; omitted counts all currently-active/inactive doctors, set scopes to doctors created in that range
   */
  async getReferralDoctorsSummary(
    tenantId: string,
    branchId?: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<DashboardSlice[]> {
    return this.countActiveInactive(
      this.prisma.referralDoctor,
      tenantId,
      branchId,
      dateFrom,
      dateTo,
    );
  }

  /**
   * Active vs. inactive external referrals.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param dateFrom/dateTo header date-range filter; omitted counts all currently-active/inactive referrals, set scopes to referrals created in that range
   */
  async getExternalReferralsSummary(
    tenantId: string,
    branchId?: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<DashboardSlice[]> {
    return this.countActiveInactive(
      this.prisma.externalReferral,
      tenantId,
      branchId,
      dateFrom,
      dateTo,
    );
  }

  /**
   * Active vs. inactive internal referrals.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param dateFrom/dateTo header date-range filter; omitted counts all currently-active/inactive referrals, set scopes to referrals created in that range
   */
  async getInternalReferralsSummary(
    tenantId: string,
    branchId?: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<DashboardSlice[]> {
    return this.countActiveInactive(
      this.prisma.internalReferral,
      tenantId,
      branchId,
      dateFrom,
      dateTo,
    );
  }

  /**
   * Active staff headcount grouped by role, for the branch-admin/
   * business-admin dashboards' "Users by Role" bar chart. Counts
   * `UserBranchProfile` rows with `branchStatus: ACTIVE` (inactive/
   * soft-deleted assignments excluded), grouped by `AuthRole.name` — the
   * real role label (e.g. "Receptionist", "Junior Lab Technician"), not the
   * mock's fixed 10-category list. `AuthRole` is a GLOBAL table (no
   * `tenantId` column), so the grouping itself is tenant-scoped via
   * `UserBranchProfile.tenantId`, not the role definitions.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param dateFrom/dateTo business-admin header's date-range filter; omitted counts all currently-active assignments, set scopes to assignments created in that range (branch-admin never passes these, so its own call is unaffected)
   */
  async getUsersByRoleSummary(
    tenantId: string,
    branchId?: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<DashboardSlice[]> {
    const createdAt = createdAtRange(dateFrom, dateTo);
    const grouped = await this.prisma.userBranchProfile.groupBy({
      by: ['authRoleId'],
      where: {
        tenantId,
        ...branchWhere(branchId),
        branchStatus: StaffStatus.ACTIVE,
        deletedAt: null,
        ...(createdAt && { createdAt }),
      },
      _count: { _all: true },
    });
    if (grouped.length === 0) {
      return [];
    }

    const roleIds = grouped.map((g) => g.authRoleId);
    const roles = await this.prisma.authRole.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(roles.map((r) => [r.id, r.name]));

    return grouped
      .filter((g) => nameById.has(g.authRoleId))
      .map((g) => ({
        label: nameById.get(g.authRoleId)!,
        value: g._count._all,
      }));
  }

  /**
   * Org-wide summary stats for the business-admin dashboard's top stat row
   * (Total Branches, Active Users) — the one row with no branch-admin
   * equivalent or branch filter, since it's inherently tenant-wide. "Total
   * Branches" counts non-deleted `Branch` rows regardless of status (same
   * convention as `BranchService.findAllForTenant`'s listing query — ACTIVE/
   * INACTIVE/UNDER_MAINTENANCE all count, since they're all still real
   * branches the tenant manages). "Active Users" counts
   * `TenantStaffMembership` rows with `status: ACTIVE` (the tenant-global
   * account status — one row per person per tenant, already deduplicated,
   * unlike `UserBranchProfile` which has one row per branch assignment; same
   * convention `UsersService` already uses for its own active-staff reads).
   * @param dateFrom/dateTo header date-range filter; omitted returns each
   *   count as of now, set scopes both counts to rows created in that range
   */
  async getStatsSummary(
    tenantId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<DashboardSlice[]> {
    const createdAt = createdAtRange(dateFrom, dateTo);
    const [totalBranches, activeUsers] = await Promise.all([
      this.prisma.branch.count({
        where: { tenantId, deletedAt: null, ...(createdAt && { createdAt }) },
      }),
      this.prisma.tenantStaffMembership.count({
        where: {
          tenantId,
          deletedAt: null,
          status: StaffStatus.ACTIVE,
          ...(createdAt && { createdAt }),
        },
      }),
    ]);
    return [
      { label: 'Total Branches', value: totalBranches },
      { label: 'Active Users', value: activeUsers },
    ];
  }

  /**
   * Weekly open/closed schedule with per-shift timing, for the branch-admin/
   * business-admin dashboards' "Schedule Plan (Weekly)" table. Finds the
   * branch's one ACTIVE `Schedule` whose effective-date range covers today
   * (there can be at most one, enforced by `ScheduleService`); explodes its
   * `shifts` JSON (each carrying its own `activeDays`) into a fixed
   * Sunday-first weekly grid. A day with no shift covering it is "Closed".
   * Returns `[]` (empty) if the branch has no such schedule — the frontend's
   * existing "No schedule data to display" empty state handles that, same as
   * every other card's genuine-no-data case.
   * @param branchId required — a schedule is always branch-specific, unlike every other dashboard method's optional tenant-wide fallback
   */
  async getSchedulePlanSummary(
    tenantId: string,
    branchId: string,
  ): Promise<ScheduleDayRow[]> {
    const today = new Date();
    const todayDateOnly = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const schedule = await this.prisma.schedule.findFirst({
      where: {
        tenantId,
        branchId,
        status: ScheduleStatus.ACTIVE,
        deletedAt: null,
        effectiveFrom: { lte: todayDateOnly },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: todayDateOnly } }],
      },
    });
    if (!schedule) {
      return [];
    }

    const shifts = schedule.shifts as unknown as Array<{
      shiftName: ShiftName;
      startTime: string;
      endTime: string;
      breakStartTime: string;
      breakEndTime: string;
      activeDays: DayOfWeek[];
    }>;

    const displayOrder: DayOfWeek[] = [
      DayOfWeek.SUNDAY,
      DayOfWeek.MONDAY,
      DayOfWeek.TUESDAY,
      DayOfWeek.WEDNESDAY,
      DayOfWeek.THURSDAY,
      DayOfWeek.FRIDAY,
      DayOfWeek.SATURDAY,
    ];
    const dayLabel: Record<DayOfWeek, string> = {
      SUNDAY: 'Sunday',
      MONDAY: 'Monday',
      TUESDAY: 'Tuesday',
      WEDNESDAY: 'Wednesday',
      THURSDAY: 'Thursday',
      FRIDAY: 'Friday',
      SATURDAY: 'Saturday',
    };
    const shiftKey: Record<
      ShiftName,
      'morningShift' | 'afternoonShift' | 'eveningShift' | 'nightShift'
    > = {
      MORNING: 'morningShift',
      AFTERNOON: 'afternoonShift',
      EVENING: 'eveningShift',
      NIGHT: 'nightShift',
    };

    return displayOrder.map((day) => {
      const row: ScheduleDayRow = {
        day: dayLabel[day],
        status: 'Closed',
        morningShift: null,
        afternoonShift: null,
        eveningShift: null,
        nightShift: null,
      };
      for (const shift of shifts) {
        if (!shift.activeDays.includes(day)) continue;
        row.status = 'Open';
        row[shiftKey[shift.shiftName]] =
          `${this.formatClockTime(shift.startTime)} - ${this.formatClockTime(shift.endTime)} ` +
          `(Break: ${this.formatClockTime(shift.breakStartTime)} - ${this.formatClockTime(shift.breakEndTime)})`;
      }
      return row;
    });
  }

  /** Format a 24h `HH:mm` time as 12h with AM/PM, e.g. "06:00" -> "06:00 AM". */
  private formatClockTime(hhmm: string): string {
    const [h = 0, m = 0] = hhmm.split(':').map(Number);
    const period = h < 12 ? 'AM' : 'PM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
  }

  /**
   * Shared Active/Inactive count for any model with a `status` field using
   * that two-value convention (`ReferralDoctor`, `ExternalReferral`,
   * `InternalReferral` all share the same ACTIVE/INACTIVE enum shape, just
   * under different Prisma-generated enum types). `branchId` omitted (or
   * "all") aggregates across the whole tenant — the business-admin case.
   */
  private async countActiveInactive(
    delegate: {
      count(args: {
        where: {
          tenantId: string;
          branchId?: string | { in: string[] };
          status: 'ACTIVE' | 'INACTIVE';
          deletedAt: null;
          createdAt?: { gte: Date; lt: Date };
        };
      }): Promise<number>;
    },
    tenantId: string,
    branchId?: string | string[],
    dateFrom?: string,
    dateTo?: string,
  ): Promise<DashboardSlice[]> {
    const createdAt = createdAtRange(dateFrom, dateTo);
    const scope = {
      tenantId,
      ...branchWhere(branchId),
      ...(createdAt && { createdAt }),
    };
    const [active, inactive] = await Promise.all([
      delegate.count({
        where: { ...scope, status: 'ACTIVE', deletedAt: null },
      }),
      delegate.count({
        where: { ...scope, status: 'INACTIVE', deletedAt: null },
      }),
    ]);
    return [
      { label: 'Active', value: active },
      { label: 'Inactive', value: inactive },
    ];
  }

  /**
   * Referral panels, grouped by client (payment) type.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param dateFrom/dateTo header date-range filter; omitted counts all currently-active panels, set scopes to panels created in that range
   */
  async getReferralPanelsSummary(
    tenantId: string,
    branchId?: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<DashboardSlice[]> {
    const createdAt = createdAtRange(dateFrom, dateTo);
    const grouped = await this.prisma.referralPanel.groupBy({
      by: ['clientType'],
      where: {
        tenantId,
        ...branchWhere(branchId),
        isActive: true,
        deletedAt: null,
        ...(createdAt && { createdAt }),
      },
      _count: { _all: true },
    });
    const labelByType: Record<string, string> = {
      CASH: 'Cash',
      PREPAID: 'Prepaid',
      POSTPAID: 'Postpaid',
    };
    return grouped.map((g) => ({
      label: labelByType[g.clientType] ?? g.clientType,
      value: g._count._all,
    }));
  }

  /**
   * Appointments, grouped by status, for the Registration dashboard's
   * "Appointments – Status" bar chart. Every `AppointmentStatus` value is
   * always returned (zero-filled), even with no appointments in that status,
   * so the chart's bar order/labels stay stable rather than only showing
   * whichever statuses happen to have data.
   *
   * `module` selects which bucket to show (confirmed with the user):
   * - `'diagnostic'` (default): `AppointmentType = DIAGNOSTIC` appointments
   *   whose linked order's `OrderDiagnostics.isHomeVisit` is `false`/unset —
   *   the normal in-branch diagnostics case.
   * - `'phlebotomist'`: the SAME `DIAGNOSTIC` appointment type, but where
   *   `isHomeVisit = true` — a home-visit collection genuinely involves a
   *   phlebotomist (a real `phlebotomistId` gets assigned on the order only
   *   in this case, per the Create Order form), so it's split into its own
   *   bucket rather than counted as a plain "Diagnostic" appointment. This is
   *   NOT a real `AppointmentType` value — "Phlebotomist" doesn't exist in
   *   the schema; it's derived from the same DIAGNOSTIC type + the home-visit
   *   flag on its order.
   * - `'consultant'` / `'radiologist'`: disabled placeholders for now
   *   (confirmed with the user) — always returns all-zero, same convention
   *   as this dashboard's Pharmacy/IPD stubs elsewhere (no backing distinction
   *   exists yet between a plain OPD/Radiology appointment and one that would
   *   warrant its own consultant/radiologist bucket).
   * A B2B appointment (`Order.referralPanelId` set) still counts under
   * whichever module bucket its underlying order type resolves to —
   * `referralPanelId` is an orthogonal tag, not a separate bucket (confirmed
   * with the user: "the new B2B diagnostic will be under diagnostic").
   * @param branchId branch scope; omitted aggregates across the whole tenant;
   * an array aggregates across exactly those branches (a Business Admin's
   * "All Branches" view, pre-resolved to their module-accessible set)
   */
  async getAppointmentsStatusSummary(
    tenantId: string,
    branchId?: string | string[],
    module: AppointmentsStatusModule = 'diagnostic',
  ): Promise<DashboardSlice[]> {
    const labelByStatus: Record<AppointmentStatus, string> = {
      NEW: 'New',
      CONFIRMED: 'Confirmed',
      CHECKED_IN: 'Checked In',
      IN_PROGRESS: 'In Progress',
      RESCHEDULED: 'Rescheduled',
      CANCELLED: 'Canceled',
      COMPLETED: 'Completed',
    };
    // Fixed display order (matches the FE's mock fixture order), not the
    // enum's declaration order.
    const displayOrder: AppointmentStatus[] = [
      'NEW',
      'CONFIRMED',
      'CHECKED_IN',
      'IN_PROGRESS',
      'RESCHEDULED',
      'CANCELLED',
      'COMPLETED',
    ];

    if (module === 'consultant' || module === 'radiologist') {
      return displayOrder.map((status) => ({
        label: labelByStatus[status],
        value: 0,
      }));
    }

    const isHomeVisit = module === 'phlebotomist';
    const appointments = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        ...branchWhere(branchId),
        deletedAt: null,
        appointmentType: 'DIAGNOSTIC',
        order: { is: { diagnostics: { is: { isHomeVisit } } } },
      },
      select: { status: true },
    });
    const countByStatus = new Map<AppointmentStatus, number>();
    for (const a of appointments) {
      countByStatus.set(a.status, (countByStatus.get(a.status) ?? 0) + 1);
    }
    return displayOrder.map((status) => ({
      label: labelByStatus[status],
      value: countByStatus.get(status) ?? 0,
    }));
  }

  /**
   * Quotations (orders with a `quotationStatus`), grouped into Draft/
   * Converted/Expired, for the Registration dashboard's "Quotations" donut.
   * Mirrors `OrderService.findAll`'s `quotationStatus` filter logic exactly
   * (order.service.ts) so this count never disagrees with the Quotations
   * list screen: `EXPIRED` includes both rows already stored as EXPIRED and
   * DRAFT rows whose validity window (the branch's Registration Settings —
   * `Quotation_QuotationValidityValue`/`Unit`, anchored on `orderDate`) has
   * passed; `DRAFT` only counts rows still within that window.
   * @param branchId branch scope — required (the validity window is a
   * per-branch setting, so a tenant-wide aggregate would need to mix windows
   * from different branches, which isn't a meaningful single query)
   */
  /**
   * Every active staff `Person` with Registration module access at this
   * branch, for the Registration dashboard's User Filter dropdowns —
   * `UserBranchProfile.enabledModules` contains `'registration'`. Feeds
   * `createdBy` back into Quotations/Billings/Collections/Outstandings/
   * Canceled/Refunds/Payment Status: those cards only ever filter to a
   * single selected user, they don't group by user.
   * @param branchId branch scope — a single branch, or an array for a
   * Business Admin's "All Branches" view (pre-resolved to their
   * module-accessible set)
   */
  async getRegistrationUsers(
    tenantId: string,
    branchId: string | string[],
  ): Promise<RegistrationUserOption[]> {
    const profiles = await this.prisma.userBranchProfile.findMany({
      where: {
        tenantId,
        ...branchWhere(branchId),
        deletedAt: null,
        isActive: true,
        branchStatus: 'ACTIVE',
        enabledModules: { has: 'registration' },
      },
      select: { personId: true },
      distinct: ['personId'],
    });
    if (profiles.length === 0) return [];

    const persons = await this.prisma.person.findMany({
      where: { id: { in: profiles.map((p) => p.personId) } },
      select: { id: true, firstName: true, middleName: true, lastName: true },
    });
    return persons
      .map((p) => ({
        id: p.id,
        name:
          [p.firstName, p.middleName, p.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || p.id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * @param branchId a single branch, or an array for a Business Admin's "All
   * Branches" view. The quotation-validity window is a per-branch
   * Registration Setting (not a tenant-wide constant), so a multi-branch
   * aggregate genuinely cannot be one query — this loops per branch and sums
   * the three counts, rather than picking one branch's window to apply to
   * all of them.
   */
  async getQuotationsSummary(
    tenantId: string,
    branchId: string | string[],
    createdBy?: string,
  ): Promise<DashboardSlice[]> {
    const branchIds = Array.isArray(branchId) ? branchId : [branchId];
    const perBranch = await Promise.all(
      branchIds.map((id) =>
        this.getQuotationsSummaryForBranch(tenantId, id, createdBy),
      ),
    );
    return [
      { label: 'Draft', value: perBranch.reduce((sum, r) => sum + r.draft, 0) },
      {
        label: 'Converted',
        value: perBranch.reduce((sum, r) => sum + r.converted, 0),
      },
      {
        label: 'Expired',
        value: perBranch.reduce((sum, r) => sum + r.expired, 0),
      },
    ];
  }

  /** Single-branch quotation counts — the real query behind {@link getQuotationsSummary}. */
  private async getQuotationsSummaryForBranch(
    tenantId: string,
    branchId: string,
    createdBy?: string,
  ): Promise<{ draft: number; converted: number; expired: number }> {
    const settings = await this.registrationSettingsService.getForBranch(
      tenantId,
      branchId,
    );
    const expiryCutoff = subtractInterval(
      new Date(),
      settings.Quotation_QuotationValidityValue,
      settings.Quotation_QuotationValidityUnit,
    );

    const baseWhere = {
      tenantId,
      branchId,
      deletedAt: null,
      quotationStatus: { not: null },
      ...(createdBy ? { createdBy } : {}),
    };

    const [draft, expired, converted] = await Promise.all([
      this.prisma.order.count({
        where: {
          ...baseWhere,
          quotationStatus: QuotationStatus.DRAFT,
          orderDate: { gte: expiryCutoff },
        },
      }),
      this.prisma.order.count({
        where: {
          ...baseWhere,
          OR: [
            { quotationStatus: QuotationStatus.EXPIRED },
            {
              quotationStatus: QuotationStatus.DRAFT,
              orderDate: { lt: expiryCutoff },
            },
          ],
        },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, quotationStatus: QuotationStatus.CONVERTED },
      }),
    ]);

    return { draft, converted, expired };
  }

  /**
   * Active vs. inactive headcount for Doctors, Phlebotomists, and
   * Radiologists, for the Registration dashboard's "Active/Inactive – Staff"
   * grouped bar chart.
   *
   * Doctors have their own model with a direct `status` field —
   * `countActiveInactive()` handles that case already. Phlebotomists and
   * Radiologists have no master table (per `UsersService`'s doc comments on
   * `PHLEBOTOMIST_ROLE_KEYS`/`RADIOLOGIST_ROLE_KEYS`) — they're staff
   * `Person`s holding that role at a branch via `UserBranchProfile.authRole`,
   * so their active/inactive counts come from `UserBranchProfile.branchStatus`
   * instead, grouped by role key (mirrors
   * `PhlebotomistDirectoryService.branchProfiles`'s query shape).
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getStaffAvailabilitySummary(
    tenantId: string,
    branchId?: string | string[],
  ): Promise<StaffAvailabilitySlice[]> {
    const [doctors, phlebotomists, radiologists] = await Promise.all([
      this.countActiveInactive(this.prisma.doctor, tenantId, branchId),
      this.countActiveByRoleKeys(tenantId, branchId, PHLEBOTOMIST_ROLE_KEYS),
      this.countActiveByRoleKeys(tenantId, branchId, RADIOLOGIST_ROLE_KEYS),
    ]);
    const toSlice = (
      role: string,
      slices: DashboardSlice[],
    ): StaffAvailabilitySlice => ({
      role,
      active: slices.find((s) => s.label === 'Active')?.value ?? 0,
      inactive: slices.find((s) => s.label === 'Inactive')?.value ?? 0,
    });
    return [
      toSlice('Doctors', doctors),
      toSlice('Phlebotomists', phlebotomists),
      toSlice('Radiologists', radiologists),
    ];
  }

  /**
   * Active vs. inactive count of staff `Person`s holding one of `roleKeys` at
   * a branch (one `UserBranchProfile` per person per branch — dedupe isn't
   * needed here since we're counting profiles, not distinct persons, and a
   * person only ever holds one role assignment per branch in practice).
   */
  private async countActiveByRoleKeys(
    tenantId: string,
    branchId: string | string[] | undefined,
    roleKeys: string[],
  ): Promise<DashboardSlice[]> {
    const scope = {
      tenantId,
      ...branchWhere(branchId),
      deletedAt: null,
      authRole: { key: { in: roleKeys } },
    };
    const [active, inactive] = await Promise.all([
      this.prisma.userBranchProfile.count({
        where: { ...scope, branchStatus: StaffStatus.ACTIVE },
      }),
      this.prisma.userBranchProfile.count({
        where: { ...scope, branchStatus: StaffStatus.INACTIVE },
      }),
    ]);
    return [
      { label: 'Active', value: active },
      { label: 'Inactive', value: inactive },
    ];
  }

  /**
   * Orders, grouped by module (Diagnostics/OPD/Radiology/Pharmacy/IPD), for
   * the Registration dashboard's "Orders" bar chart. Diagnostics/OPD/
   * Radiology count real orders (an order matches a module when its
   * corresponding section relation exists — same relation-existence pattern
   * `OrderService.findAll`'s `section` filter uses). Pharmacy and IPD have no
   * backing order-section model yet (there is no `OrderPharmacy`/`OrderIpd`),
   * so they always report 0 rather than being omitted — the chart keeps a
   * stable 5-bar shape, and 0 here means "not trackable yet", not "no orders".
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param dateMode which orders count, by `orderDate` relative to today:
   * `'today'` (default) = orderDate is today, `'backdated'` = before today,
   * `'advanced-dated'` = after today.
   */
  async getOrdersSummary(
    tenantId: string,
    branchId?: string | string[],
    dateMode: OrderDateMode = 'today',
  ): Promise<DashboardSlice[]> {
    const { todayStart, todayEnd } = this.getUtcTodayBounds();

    const orderDate: { gte?: Date; lt?: Date } =
      dateMode === 'backdated'
        ? { lt: todayStart }
        : dateMode === 'advanced-dated'
          ? { gte: todayEnd }
          : { gte: todayStart, lt: todayEnd };

    const baseWhere = {
      tenantId,
      ...branchWhere(branchId),
      deletedAt: null,
      orderDate,
    };

    const [diagnostics, opd, radiology] = await Promise.all([
      this.prisma.order.count({
        where: { ...baseWhere, diagnostics: { is: {} } },
      }),
      this.prisma.order.count({ where: { ...baseWhere, opd: { is: {} } } }),
      this.prisma.order.count({
        where: { ...baseWhere, radiology: { is: {} } },
      }),
    ]);

    return [
      { label: 'Diagnostics', value: diagnostics },
      { label: 'OPD', value: opd },
      { label: 'Radiology', value: radiology },
      { label: 'Pharmacy', value: 0 },
      { label: 'IPD', value: 0 },
    ];
  }

  /**
   * New vs. previous vs. total patients (each split Male/Female/Total), for
   * the Registration dashboard's "Patients" card. Scoped to patients with at
   * least one order today: "New" = their earliest order ever is today (a
   * first-timer); "Previous" = they have at least one earlier order too (a
   * returning patient). "Total" is New + Previous, not an independent query.
   *
   * There is no "new vs. previous" flag anywhere in the schema (confirmed —
   * this is derived at query time): fetch every patient with an order in the
   * selected window, then check which of those same patients also have an
   * order strictly before that window; the rest are New.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param dateMode which orders count, by `orderDate` relative to today:
   * `'today'` (default) = orderDate is today, `'backdated'` = before today,
   * `'advanced-dated'` = after today. "Previous" is always relative to the
   * start of the selected window, not always "before today" — e.g. in
   * `'advanced-dated'` mode, a patient's prior order any time before that
   * future date (including today) still counts as a return visit.
   */
  async getPatientsSummary(
    tenantId: string,
    branchId?: string | string[],
    dateMode: OrderDateMode = 'today',
  ): Promise<PatientsSummary> {
    const { todayStart, todayEnd } = this.getUtcTodayBounds();
    const scope = { tenantId, ...branchWhere(branchId) };

    const windowStart = dateMode === 'advanced-dated' ? todayEnd : todayStart;
    const orderDate: { gte?: Date; lt?: Date } =
      dateMode === 'backdated'
        ? { lt: todayStart }
        : dateMode === 'advanced-dated'
          ? { gte: todayEnd }
          : { gte: todayStart, lt: todayEnd };

    const windowOrders = await this.prisma.order.findMany({
      where: {
        ...scope,
        deletedAt: null,
        orderDate,
      },
      select: { patientId: true },
      distinct: ['patientId'],
    });
    const patientIds = windowOrders.map((o) => o.patientId);
    if (patientIds.length === 0) {
      const empty: PatientBucket = { male: 0, female: 0, total: 0 };
      return {
        newPatients: { ...empty },
        previousPatients: { ...empty },
        totalPatients: { ...empty },
      };
    }

    const [priorOrders, patients] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          ...scope,
          deletedAt: null,
          patientId: { in: patientIds },
          orderDate: { lt: windowStart },
        },
        select: { patientId: true },
        distinct: ['patientId'],
      }),
      this.prisma.patient.findMany({
        where: { id: { in: patientIds } },
        select: { id: true, gender: true },
      }),
    ]);
    const returningPatientIds = new Set(priorOrders.map((o) => o.patientId));
    const genderById = new Map(patients.map((p) => [p.id, p.gender]));

    const newPatients: PatientBucket = { male: 0, female: 0, total: 0 };
    const previousPatients: PatientBucket = { male: 0, female: 0, total: 0 };
    for (const patientId of patientIds) {
      const bucket = returningPatientIds.has(patientId)
        ? previousPatients
        : newPatients;
      bucket.total += 1;
      const gender = genderById.get(patientId);
      if (gender === 'MALE') bucket.male += 1;
      else if (gender === 'FEMALE') bucket.female += 1;
    }

    return {
      newPatients,
      previousPatients,
      totalPatients: {
        male: newPatients.male + previousPatients.male,
        female: newPatients.female + previousPatients.female,
        total: newPatients.total + previousPatients.total,
      },
    };
  }

  /**
   * Billings breakdown (Gross/Discount/Net/Paid Online/Paid Cash/Balance/
   * Canceled/TDS), for the Registration dashboard's "Billings" card.
   * Confirmed formulas (no existing convention to reuse — defined explicitly
   * with the user):
   * - `totalBillings` (donut center) = Σ `netAmount`.
   * - Gross/Discount/Net/TDS = straight sums of the matching `PaymentDetails`
   *   column. Balance is NOT a straight sum of `remainingBalance` — that
   *   column is a snapshot written at payment time and never revisited when
   *   a LATER payment row settles the same order, so summing it across rows
   *   double-counts stale snapshots (confirmed live: an order paid across two
   *   installments showed a nonzero Balance after being fully paid). Balance
   *   is instead Σ over orders of `max(0, net − effectivePaid)`, using the
   *   same `computeEffectivePaid` helper Outstandings relies on.
   * - Paid Cash = Σ `paidAmount` where `paymentMode = CASH`; Paid Online = Σ
   *   `paidAmount` for every other `paymentMode`.
   * - Canceled = Σ `totalAmount` for orders with `status = CANCELLED` (no
   *   dedicated cancellation-amount field exists).
   * - Refund is omitted entirely (like other dashboards' blocked buckets) —
   *   no `Refund` model/field exists anywhere near Order/PaymentDetails.
   * - Percentages: Gross is `% of totalBillings` (naturally >100% since
   *   totalBillings is Net, not Gross — a meaningful "gross-up" signal);
   *   every other row is `% of Gross`, EXCEPT Canceled — cancelled orders are
   *   a population deliberately excluded from Gross (so a cancelled order's
   *   amount never counts twice), so there's no valid "% of Gross" for it;
   *   its `percentLabel` is `''` (no percentage shown at all), confirmed with
   *   the user rather than showing a misleading 0.00% whenever Gross is 0.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param dateMode Today/Backdated/Advanced Dated relative to `orderDate`; defaults to Today
   * @param module Diagnostics/OPD/Radiology/Pharmacy/IPD/All; Pharmacy/IPD
   * always report 0 (no backing order-section model, same as Orders)
   */
  async getBillingsSummary(
    tenantId: string,
    branchId?: string | string[],
    dateMode: OrderDateMode = 'today',
    module: BillingsModule = 'all',
    createdBy?: string,
  ): Promise<BillingsSummary> {
    if (module === 'pharmacy' || module === 'ipd') {
      return {
        totalBillings: 0,
        rows: [
          { label: 'Gross', amount: 0, percentLabel: '0.00%' },
          { label: 'Discount', amount: 0, percentLabel: '0.00%' },
          { label: 'Net', amount: 0, percentLabel: '0.00%' },
          { label: 'Paid Online', amount: 0, percentLabel: '0.00%' },
          { label: 'Paid Cash', amount: 0, percentLabel: '0.00%' },
          { label: 'Balance', amount: 0, percentLabel: '0.00%' },
          { label: 'Canceled', amount: 0, percentLabel: '' },
          { label: 'TDS', amount: 0, percentLabel: '0.00%' },
        ],
      };
    }

    const { todayStart, todayEnd } = this.getUtcTodayBounds();
    const orderDate: { gte?: Date; lt?: Date } =
      dateMode === 'backdated'
        ? { lt: todayStart }
        : dateMode === 'advanced-dated'
          ? { gte: todayEnd }
          : { gte: todayStart, lt: todayEnd };

    // Gross/Discount/Net/Balance/TDS/Paid-* deliberately exclude CANCELLED
    // orders — otherwise a cancelled order's payment row would double-count
    // into both its own "Canceled" bucket AND the live Gross/Net/etc sums.
    const orderScope = {
      tenantId,
      ...branchWhere(branchId),
      deletedAt: null,
      orderDate,
      status: { not: 'CANCELLED' as const },
      ...this.getModuleFilter(module),
      ...(createdBy ? { createdBy } : {}),
    };

    const [paymentSums, cashPaid, onlinePaid, canceledGross, byOrder] =
      await Promise.all([
        this.prisma.paymentDetails.aggregate({
          where: { deletedAt: null, order: orderScope },
          _sum: {
            totalAmount: true,
            orderDiscount: true,
            netAmount: true,
            tdsDeduction: true,
          },
        }),
        this.prisma.paymentDetails.aggregate({
          where: { deletedAt: null, paymentMode: 'CASH', order: orderScope },
          _sum: { paidAmount: true },
        }),
        this.prisma.paymentDetails.aggregate({
          where: {
            deletedAt: null,
            paymentMode: { not: 'CASH' },
            order: orderScope,
          },
          _sum: { paidAmount: true },
        }),
        this.prisma.paymentDetails.aggregate({
          where: {
            deletedAt: null,
            order: { ...orderScope, status: 'CANCELLED' },
          },
          _sum: { totalAmount: true },
        }),
        // Balance = Σ(net − live effective-paid) per order, NOT a straight sum of
        // PaymentDetails.remainingBalance — that column is a snapshot written at
        // payment time and never revisited when a LATER payment row settles the
        // same order, so summing it across rows double-counts stale snapshots
        // (same staleness bug originally found and fixed on Outstandings).
        this.prisma.paymentDetails.groupBy({
          by: ['orderId'],
          where: { deletedAt: null, order: orderScope },
          _sum: {
            netAmount: true,
            paidAmount: true,
            refundAmount: true,
            refundCharge: true,
          },
        }),
      ]);

    const gross = paymentSums._sum.totalAmount?.toNumber() ?? 0;
    const discount = paymentSums._sum.orderDiscount?.toNumber() ?? 0;
    const net = paymentSums._sum.netAmount?.toNumber() ?? 0;
    const tds = paymentSums._sum.tdsDeduction?.toNumber() ?? 0;
    const paidCash = cashPaid._sum.paidAmount?.toNumber() ?? 0;
    const paidOnline = onlinePaid._sum.paidAmount?.toNumber() ?? 0;
    const canceled = canceledGross._sum.totalAmount?.toNumber() ?? 0;
    const totalBillings = net;

    const cancellationChargeByOrder = await this.prisma.order.findMany({
      where: { id: { in: byOrder.map((g) => g.orderId) } },
      select: { id: true, cancellationCharge: true },
    });
    const cancellationChargeById = new Map(
      cancellationChargeByOrder.map((o) => [o.id, o.cancellationCharge]),
    );
    const balance = byOrder.reduce((sum, g) => {
      const orderNet = g._sum.netAmount?.toNumber() ?? 0;
      const effectivePaid = computeEffectivePaid(
        g._sum.paidAmount?.toNumber() ?? 0,
        cancellationChargeById.get(g.orderId)?.toNumber() ?? 0,
        g._sum.refundAmount?.toNumber() ?? 0,
        g._sum.refundCharge?.toNumber() ?? 0,
      );
      return sum + Math.max(0, orderNet - effectivePaid);
    }, 0);

    const pct = (amount: number, base: number): string =>
      base > 0 ? `${((amount / base) * 100).toFixed(2)}%` : '0.00%';

    return {
      totalBillings,
      rows: [
        {
          label: 'Gross',
          amount: gross,
          percentLabel: pct(gross, totalBillings),
        },
        {
          label: 'Discount',
          amount: discount,
          percentLabel: pct(discount, gross),
        },
        { label: 'Net', amount: net, percentLabel: pct(net, gross) },
        {
          label: 'Paid Online',
          amount: paidOnline,
          percentLabel: pct(paidOnline, gross),
        },
        {
          label: 'Paid Cash',
          amount: paidCash,
          percentLabel: pct(paidCash, gross),
        },
        {
          label: 'Balance',
          amount: balance,
          percentLabel: pct(balance, gross),
        },
        // Canceled is drawn from cancelled orders — a population deliberately
        // excluded from Gross (so nothing double-counts). There is no valid
        // "% of Gross" for it, so no percentage is shown at all rather than a
        // misleading 0.00% when Gross happens to be 0 (confirmed with the user).
        { label: 'Canceled', amount: canceled, percentLabel: '' },
        { label: 'TDS', amount: tds, percentLabel: pct(tds, gross) },
      ],
    };
  }

  /**
   * Top 5 individual cancellation-charge amounts retained by the lab, for
   * the Cancellation card's User-wise view. `cancelledBy` omitted ("All
   * Users" selected) spans every canceller; a specific `cancelledBy` scopes
   * to just that user's own cancellations — still capped at 5 (unlike
   * {@link getTopOutstandingDues}'s per-user case, which is uncapped; this
   * card is framed as "Top 5" in every state, confirmed with the user).
   * Each due is tagged with the patient AND whichever Registration user
   * CANCELLED that order
   * (`Order.updatedBy` — stamped with the acting user at the exact moment
   * `OrderService.cancel()` flips an order to `CANCELLED`; reliable because
   * cancellation is the terminal state-changing action on an order, so
   * `updatedBy` doesn't get overwritten by anything after it). Whether the
   * cancellation also included a refund is irrelevant here — the charge is
   * retained either way (confirmed with the user: not split by
   * refund/no-refund).
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getTopCancellationCharges(
    tenantId: string,
    branchId?: string | string[],
    cancelledBy?: string,
  ): Promise<TopCancellationCharge[]> {
    return this.getTopCancellationChargesFiltered(tenantId, branchId, {
      ...(cancelledBy ? { updatedBy: cancelledBy } : {}),
    });
  }

  /**
   * Top 5 individual cancellation-charge amounts among B2B (referral-panel-
   * linked) cancelled orders, for the Cancellation card's B2B view.
   * `referralPanelId` omitted ("All B2B" selected) spans every panel-linked
   * cancellation (orders with NO referral panel are excluded entirely — this
   * view only ever looks at orders that came from B2B); a specific panel
   * scopes to just that panel's own cancellations — still capped at 5. Each
   * due is still tagged with the canceller, same as the User-wise view.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getTopCancellationChargesByPanel(
    tenantId: string,
    branchId?: string | string[],
    referralPanelId?: string,
  ): Promise<TopCancellationCharge[]> {
    return this.getTopCancellationChargesFiltered(tenantId, branchId, {
      referralPanelId: referralPanelId ?? { not: null },
    });
  }

  /**
   * Shared query behind {@link getTopCancellationCharges}/
   * {@link getTopCancellationChargesByPanel}: cancelled orders with a
   * nonzero charge, optionally narrowed by `extraOrderWhere`, top 5 by
   * charge, each resolved to its patient + canceller display names.
   */
  private async getTopCancellationChargesFiltered(
    tenantId: string,
    branchId: string | string[] | undefined,
    extraOrderWhere: Record<string, unknown>,
  ): Promise<TopCancellationCharge[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        ...branchWhere(branchId),
        deletedAt: null,
        status: 'CANCELLED',
        cancellationCharge: { gt: 0 },
        ...extraOrderWhere,
      },
      select: {
        id: true,
        updatedBy: true,
        cancellationCharge: true,
        patientId: true,
      },
      orderBy: { cancellationCharge: 'desc' },
      take: 5,
    });
    if (orders.length === 0) {
      return [];
    }

    const personIds = [
      ...new Set(
        orders
          .map((o) => o.updatedBy)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const persons = personIds.length
      ? await this.prisma.person.findMany({
          where: { id: { in: personIds } },
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        })
      : [];
    const nameById = new Map(
      persons.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || p.id,
      ]),
    );

    const patientIds = [...new Set(orders.map((o) => o.patientId))];
    const patients = patientIds.length
      ? await this.prisma.patient.findMany({
          where: { id: { in: patientIds } },
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        })
      : [];
    const patientNameById = new Map(
      patients.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || p.id,
      ]),
    );

    return orders.map((o) => ({
      orderId: o.id,
      patientName: patientNameById.get(o.patientId) ?? 'Unknown',
      cancelledByName: o.updatedBy
        ? (nameById.get(o.updatedBy) ?? o.updatedBy)
        : 'Unknown',
      cancellationChargeAmount: o.cancellationCharge.toNumber(),
    }));
  }

  /**
   * Outstanding-balance amounts grouped by B2B referral panel, for the
   * Registration dashboard's "Outstandings" donut. Cancelled orders are
   * excluded (confirmed with the user — a cancelled order's leftover balance
   * is treated as written off, not actively collectible); only orders whose
   * recomputed live balance is still > 0 count. Amount is recomputed per
   * order from the full payment ledger via {@link getLiveOutstandingByOrder}
   * — NOT summed from the stored per-row `PaymentDetails.remainingBalance`,
   * which goes stale the moment an order accumulates a second payment row
   * (a later collection, a dues settlement, a refund — each writes a NEW
   * row; no code path ever updates an older row's `remainingBalance` in
   * place). No date filter, same as Canceled.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param referralPanelId narrows to just that one panel's orders; omitted returns every panel's own slice
   */
  async getOutstandingsSummary(
    tenantId: string,
    branchId?: string | string[],
    createdBy?: string,
    referralPanelId?: string,
  ): Promise<DashboardSlice[]> {
    const byOrder = await this.getLiveOutstandingByOrder(tenantId, branchId, {
      ...(createdBy ? { createdBy } : {}),
      ...(referralPanelId ? { referralPanelId } : {}),
    });
    if (byOrder.size === 0) {
      return [];
    }

    const panelIds = [
      ...new Set(
        [...byOrder.values()]
          .map((o) => o.referralPanelId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const panels = panelIds.length
      ? await this.prisma.referralPanel.findMany({
          where: { id: { in: panelIds }, tenantId },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(panels.map((p) => [p.id, p.name]));

    const amountByLabel = new Map<string, number>();
    for (const { outstanding, referralPanelId } of byOrder.values()) {
      const label = referralPanelId
        ? (nameById.get(referralPanelId) ?? 'Others')
        : 'Others';
      amountByLabel.set(label, (amountByLabel.get(label) ?? 0) + outstanding);
    }

    const others = amountByLabel.get('Others');
    amountByLabel.delete('Others');
    const slices = [...amountByLabel.entries()].map(([label, value]) => ({
      label,
      value,
    }));
    if (others) {
      slices.push({ label: 'Others', value: others });
    }
    return slices;
  }

  /**
   * User-wise view of the Outstandings card. Two shapes, depending on
   * `createdBy`:
   * - Omitted ("All Users" selected): the Top 5 individual outstanding dues
   *   across every Registration user at the branch — not a per-user total
   *   ranking; if the same user created the 5 largest outstanding orders,
   *   all 5 entries carry that same user's name.
   * - A specific user id: ALL of that user's own outstanding orders (no
   *   top-5 cap — the cap only applies to the cross-user ranking), sorted
   *   largest first.
   * Each due is ONE order's live outstanding balance (via
   * {@link getLiveOutstandingByOrder}), tagged with whichever user CREATED
   * that order (`Order.createdBy`) — not whoever later collected payment
   * against it. An order with both a creator and a referral panel still
   * appears here independently of the B2B view (double-counting is
   * intentional, confirmed with the user).
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getTopOutstandingDues(
    tenantId: string,
    branchId?: string | string[],
    createdBy?: string,
  ): Promise<TopOutstandingDue[]> {
    const byOrder = await this.getLiveOutstandingByOrder(
      tenantId,
      branchId,
      createdBy ? { createdBy } : {},
    );
    const sorted = [...byOrder.entries()]
      .map(([orderId, v]) => ({ orderId, ...v }))
      .sort((a, b) => b.outstanding - a.outstanding);
    const top5 = createdBy ? sorted : sorted.slice(0, 5);

    const personIds = [
      ...new Set(
        top5.map((d) => d.createdBy).filter((id): id is string => Boolean(id)),
      ),
    ];
    const persons = personIds.length
      ? await this.prisma.person.findMany({
          where: { id: { in: personIds } },
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        })
      : [];
    const nameById = new Map(
      persons.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || p.id,
      ]),
    );

    const patientIds = [...new Set(top5.map((d) => d.patientId))];
    const patients = patientIds.length
      ? await this.prisma.patient.findMany({
          where: { id: { in: patientIds } },
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        })
      : [];
    const patientNameById = new Map(
      patients.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || p.id,
      ]),
    );

    return top5.map((d) => ({
      orderId: d.orderId,
      patientName: patientNameById.get(d.patientId) ?? 'Unknown',
      createdByName: d.createdBy
        ? (nameById.get(d.createdBy) ?? d.createdBy)
        : 'Unknown',
      outstandingAmount: d.outstanding,
    }));
  }

  /**
   * Live outstanding balance per order, recomputed from the full payment
   * ledger rather than trusting the stored, per-row
   * `PaymentDetails.remainingBalance` (which only reflects the balance at
   * the moment that one row was written, and is never revisited by later
   * rows — see `PaymentDetailsService.recomputePaymentStatus` for the
   * identical formula applied to one order at a time, already trusted
   * elsewhere in this codebase). Excludes cancelled orders and any order
   * whose net is already fully covered (outstanding <= 0).
   */
  private async getLiveOutstandingByOrder(
    tenantId: string,
    branchId: string | string[] | undefined,
    extraOrderWhere: Record<string, unknown> = {},
  ): Promise<
    Map<
      string,
      {
        outstanding: number;
        createdBy: string | null;
        referralPanelId: string | null;
        patientId: string;
      }
    >
  > {
    const grouped = await this.prisma.paymentDetails.groupBy({
      by: ['orderId'],
      where: {
        deletedAt: null,
        order: {
          tenantId,
          ...branchWhere(branchId),
          deletedAt: null,
          status: { not: 'CANCELLED' },
          ...extraOrderWhere,
        },
      },
      _sum: {
        netAmount: true,
        paidAmount: true,
        refundAmount: true,
        refundCharge: true,
      },
    });
    if (grouped.length === 0) {
      return new Map();
    }

    const orderIds = grouped.map((g) => g.orderId);
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        createdBy: true,
        cancellationCharge: true,
        referralPanelId: true,
        patientId: true,
      },
    });
    const orderById = new Map(orders.map((o) => [o.id, o]));

    const result = new Map<
      string,
      {
        outstanding: number;
        createdBy: string | null;
        referralPanelId: string | null;
        patientId: string;
      }
    >();
    for (const g of grouped) {
      const order = orderById.get(g.orderId);
      if (!order) continue;
      const net = g._sum.netAmount?.toNumber() ?? 0;
      const effectivePaid = computeEffectivePaid(
        g._sum.paidAmount?.toNumber() ?? 0,
        order.cancellationCharge.toNumber(),
        g._sum.refundAmount?.toNumber() ?? 0,
        g._sum.refundCharge?.toNumber() ?? 0,
      );
      const outstanding = net - effectivePaid;
      if (outstanding > 0) {
        result.set(g.orderId, {
          outstanding,
          createdBy: order.createdBy,
          referralPanelId: order.referralPanelId,
          patientId: order.patientId,
        });
      }
    }
    return result;
  }

  /**
   * Top 5 individual refunds, for the Refunds card's User-wise view.
   * `createdBy` omitted ("All Users" selected) spans every order creator; a
   * specific `createdBy` scopes to refunds on orders THAT user created —
   * still capped at 5 (there's no reliable "who processed this refund"
   * actor stored on `PaymentDetails`, so refunds are tagged by
   * `Order.createdBy`, same convention as Outstandings — confirmed with the
   * user). Each entry is ONE `PaymentDetails` row with `entryType =
   * 'REFUND'` (both a standalone "Refund Without Cancellation" and a
   * cancel-with-refund write one of these) — an order refunded twice
   * produces two separate entries, not one summed total, since each refund
   * is its own real event (confirmed with the user). No order status filter
   * (a refund can exist on either a cancelled or still-active order); no
   * date filter — all-time.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getTopRefunds(
    tenantId: string,
    branchId?: string | string[],
    createdBy?: string,
  ): Promise<TopRefund[]> {
    return this.getTopRefundsFiltered(tenantId, branchId, {
      ...(createdBy ? { createdBy } : {}),
    });
  }

  /**
   * Top 5 individual refunds among B2B (referral-panel-linked) orders, for
   * the Refunds card's B2B view. `referralPanelId` omitted ("All B2B"
   * selected) spans every panel-linked refund (orders with NO referral
   * panel are excluded entirely); a specific panel scopes to just that
   * panel's own refunds — still capped at 5.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getTopRefundsByPanel(
    tenantId: string,
    branchId?: string | string[],
    referralPanelId?: string,
  ): Promise<TopRefund[]> {
    return this.getTopRefundsFiltered(tenantId, branchId, {
      referralPanelId: referralPanelId ?? { not: null },
    });
  }

  /**
   * Shared query behind {@link getTopRefunds}/{@link getTopRefundsByPanel}:
   * `PaymentDetails` rows with `entryType = 'REFUND'` under orders matching
   * `extraOrderWhere`, top 5 by `refundAmount`, each resolved to its
   * patient + order-creator display names.
   */
  private async getTopRefundsFiltered(
    tenantId: string,
    branchId: string | string[] | undefined,
    extraOrderWhere: Record<string, unknown>,
  ): Promise<TopRefund[]> {
    const payments = await this.prisma.paymentDetails.findMany({
      where: {
        deletedAt: null,
        entryType: 'REFUND',
        order: {
          tenantId,
          ...branchWhere(branchId),
          deletedAt: null,
          ...extraOrderWhere,
        },
      },
      select: {
        id: true,
        refundAmount: true,
        order: { select: { id: true, createdBy: true, patientId: true } },
      },
      orderBy: { refundAmount: 'desc' },
      take: 5,
    });
    if (payments.length === 0) {
      return [];
    }

    const personIds = [
      ...new Set(
        payments
          .map((p) => p.order.createdBy)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const persons = personIds.length
      ? await this.prisma.person.findMany({
          where: { id: { in: personIds } },
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        })
      : [];
    const nameById = new Map(
      persons.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || p.id,
      ]),
    );

    const patientIds = [...new Set(payments.map((p) => p.order.patientId))];
    const patients = patientIds.length
      ? await this.prisma.patient.findMany({
          where: { id: { in: patientIds } },
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        })
      : [];
    const patientNameById = new Map(
      patients.map((p) => [
        p.id,
        [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || p.id,
      ]),
    );

    return payments.map((p) => ({
      orderId: p.order.id,
      patientName: patientNameById.get(p.order.patientId) ?? 'Unknown',
      createdByName: p.order.createdBy
        ? (nameById.get(p.order.createdBy) ?? p.order.createdBy)
        : 'Unknown',
      refundAmount: p.refundAmount.toNumber(),
    }));
  }

  /**
   * Shared helper: sum one `PaymentDetails` amount column for rows matching
   * `orderWhere` (applied to the parent `Order`) and `paymentWhere` (applied
   * to the `PaymentDetails` row itself, e.g. `entryType: 'REFUND'`), grouped
   * by `Order.referralPanelId` → `ReferralPanel.name` (null/unmapped →
   * "Others"). Used by `getCanceledSummary`/`getOutstandingsSummary`/
   * `getRefundsSummary`.
   */
  private async getPanelGroupedAmount(
    tenantId: string,
    branchId: string | string[] | undefined,
    orderWhere: Record<string, unknown>,
    amountField: 'totalAmount' | 'remainingBalance' | 'refundAmount',
    paymentWhere: Record<string, unknown> = {},
  ): Promise<DashboardSlice[]> {
    const orderScope = {
      tenantId,
      ...branchWhere(branchId),
      deletedAt: null,
      ...orderWhere,
    };

    const payments = await this.prisma.paymentDetails.findMany({
      where: { deletedAt: null, order: orderScope, ...paymentWhere },
      select: {
        totalAmount: true,
        remainingBalance: true,
        refundAmount: true,
        order: { select: { referralPanelId: true } },
      },
    });
    if (payments.length === 0) {
      return [];
    }

    const panelIds = [
      ...new Set(
        payments
          .map((p) => p.order.referralPanelId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const panels = panelIds.length
      ? await this.prisma.referralPanel.findMany({
          where: { id: { in: panelIds }, tenantId },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(panels.map((p) => [p.id, p.name]));

    const amountByLabel = new Map<string, number>();
    for (const p of payments) {
      const label = p.order.referralPanelId
        ? (nameById.get(p.order.referralPanelId) ?? 'Others')
        : 'Others';
      amountByLabel.set(
        label,
        (amountByLabel.get(label) ?? 0) + p[amountField].toNumber(),
      );
    }

    const others = amountByLabel.get('Others');
    amountByLabel.delete('Others');
    const slices = [...amountByLabel.entries()].map(([label, value]) => ({
      label,
      value,
    }));
    if (others) {
      slices.push({ label: 'Others', value: others });
    }
    return slices;
  }

  /**
   * Payment-status breakdown (Pending/Partially Pending/Paid/Canceled), for
   * the Registration dashboard's "Payment Status" bar chart. Amount = Σ
   * `netAmount` (confirmed with the user — same "settled billed value"
   * convention as Billings' Net row). No date filter — this card has no
   * date-mode control in the UI (like Canceled/Outstandings), so it's an
   * all-time view. Pending/Partially Pending/Paid come from `Order.
   * paymentStatus`; Canceled comes from the separate `Order.status` enum
   * (mirrors `getBillingsSummary`'s Canceled row). Refund is omitted — no
   * backing model, same as every other blocked bucket on this dashboard.
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param module Diagnostics/OPD/Radiology/Pharmacy/IPD/All; Pharmacy/IPD
   * always report 0 (no backing order-section model, same as Orders/Billings)
   * @param createdBy User-wise view; mutually exclusive with `referralPanelId`
   * in the UI (selecting one resets the other) — the service itself just
   * applies whichever is passed.
   * @param referralPanelId B2B view; narrows to that one referral panel's orders.
   */
  async getPaymentStatusSummary(
    tenantId: string,
    branchId?: string | string[],
    module: BillingsModule = 'all',
    createdBy?: string,
    referralPanelId?: string,
  ): Promise<DashboardSlice[]> {
    if (module === 'pharmacy' || module === 'ipd') {
      return [
        { label: 'Pending', value: 0 },
        { label: 'Partially Pending', value: 0 },
        { label: 'Paid', value: 0 },
        { label: 'Canceled', value: 0 },
      ];
    }

    const baseScope = {
      tenantId,
      ...branchWhere(branchId),
      deletedAt: null,
      ...this.getModuleFilter(module),
      ...(createdBy ? { createdBy } : {}),
      ...(referralPanelId ? { referralPanelId } : {}),
    };

    const [pending, partiallyPending, paid, canceled] = await Promise.all([
      this.prisma.paymentDetails.aggregate({
        where: {
          deletedAt: null,
          order: { ...baseScope, paymentStatus: 'NOT_PAID' },
        },
        _sum: { netAmount: true },
      }),
      this.prisma.paymentDetails.aggregate({
        where: {
          deletedAt: null,
          order: { ...baseScope, paymentStatus: 'PARTIALLY_PAID' },
        },
        _sum: { netAmount: true },
      }),
      this.prisma.paymentDetails.aggregate({
        where: {
          deletedAt: null,
          order: { ...baseScope, paymentStatus: 'PAID' },
        },
        _sum: { netAmount: true },
      }),
      this.prisma.paymentDetails.aggregate({
        where: {
          deletedAt: null,
          order: { ...baseScope, status: 'CANCELLED' },
        },
        _sum: { netAmount: true },
      }),
    ]);

    return [
      { label: 'Pending', value: pending._sum.netAmount?.toNumber() ?? 0 },
      {
        label: 'Partially Pending',
        value: partiallyPending._sum.netAmount?.toNumber() ?? 0,
      },
      { label: 'Paid', value: paid._sum.netAmount?.toNumber() ?? 0 },
      { label: 'Canceled', value: canceled._sum.netAmount?.toNumber() ?? 0 },
    ];
  }

  /**
   * Gross/Discount/Net/Paid/Balance breakdown for appointment-linked orders
   * only (`Order.appointmentId` set), for the Registration dashboard's
   * "Appointment Payment Status" bar chart. Same formula as
   * `getBillingsSummary`'s core rows, except Paid Online/Paid Cash are
   * combined into a single "Paid" bucket (this card has no online/cash
   * split in its UI) — no date filter — all-time. Cancelled orders are
   * excluded from Gross/Net/etc (same double-count reasoning as Billings) —
   * this card has no "Canceled" bucket of its own to receive them. Balance
   * is computed the same live way as Billings' Balance row (Σ per-order
   * `max(0, net − effectivePaid)`, not a straight sum of the stale
   * `remainingBalance` snapshot column) — see `getBillingsSummary`'s doc
   * comment for why.
   *
   * `module` selects which bucket, mirroring
   * {@link getAppointmentsStatusSummary}'s convention exactly:
   * `'diagnostic'`/`'phlebotomist'` are both `AppointmentType.DIAGNOSTIC`
   * orders, split by `OrderDiagnostics.isHomeVisit`; `'consultant'`/
   * `'radiologist'` are disabled placeholders for now (always all-zero).
   * @param branchId branch scope; omitted aggregates across the whole tenant
   */
  async getAppointmentPaymentStatusSummary(
    tenantId: string,
    branchId?: string | string[],
    module: AppointmentsStatusModule = 'diagnostic',
  ): Promise<DashboardSlice[]> {
    const zeroRows: DashboardSlice[] = [
      { label: 'Gross', value: 0 },
      { label: 'Discount', value: 0 },
      { label: 'Net', value: 0 },
      { label: 'Paid', value: 0 },
      { label: 'Balance', value: 0 },
    ];
    if (module === 'consultant' || module === 'radiologist') {
      return zeroRows;
    }

    const isHomeVisit = module === 'phlebotomist';
    const orderScope = {
      tenantId,
      ...branchWhere(branchId),
      deletedAt: null,
      status: { not: 'CANCELLED' as const },
      appointmentId: { not: null },
      appointment: { is: { appointmentType: 'DIAGNOSTIC' as const } },
      diagnostics: { is: { isHomeVisit } },
    };

    const [paymentSums, byOrder] = await Promise.all([
      this.prisma.paymentDetails.aggregate({
        where: { deletedAt: null, order: orderScope },
        _sum: {
          totalAmount: true,
          orderDiscount: true,
          netAmount: true,
          paidAmount: true,
        },
      }),
      // Balance = Σ(net − live effective-paid) per order, NOT a straight sum
      // of PaymentDetails.remainingBalance — same staleness bug as Billings'
      // Balance row (a snapshot column, never revisited by a later payment
      // row on the same order); see getBillingsSummary's doc comment.
      this.prisma.paymentDetails.groupBy({
        by: ['orderId'],
        where: { deletedAt: null, order: orderScope },
        _sum: {
          netAmount: true,
          paidAmount: true,
          refundAmount: true,
          refundCharge: true,
        },
      }),
    ]);

    const cancellationChargeByOrder = await this.prisma.order.findMany({
      where: { id: { in: byOrder.map((g) => g.orderId) } },
      select: { id: true, cancellationCharge: true },
    });
    const cancellationChargeById = new Map(
      cancellationChargeByOrder.map((o) => [o.id, o.cancellationCharge]),
    );
    const balance = byOrder.reduce((sum, g) => {
      const orderNet = g._sum.netAmount?.toNumber() ?? 0;
      const effectivePaid = computeEffectivePaid(
        g._sum.paidAmount?.toNumber() ?? 0,
        cancellationChargeById.get(g.orderId)?.toNumber() ?? 0,
        g._sum.refundAmount?.toNumber() ?? 0,
        g._sum.refundCharge?.toNumber() ?? 0,
      );
      return sum + Math.max(0, orderNet - effectivePaid);
    }, 0);

    return [
      { label: 'Gross', value: paymentSums._sum.totalAmount?.toNumber() ?? 0 },
      {
        label: 'Discount',
        value: paymentSums._sum.orderDiscount?.toNumber() ?? 0,
      },
      { label: 'Net', value: paymentSums._sum.netAmount?.toNumber() ?? 0 },
      { label: 'Paid', value: paymentSums._sum.paidAmount?.toNumber() ?? 0 },
      { label: 'Balance', value: balance },
    ];
  }

  /**
   * Payment-mode breakdown for the Registration dashboard's "Collections"
   * bar chart. No module filter (same as Canceled/Outstandings). Cancelled
   * orders are excluded, consistent with every other live bucket on this
   * dashboard (Billings/Payment Status/Appointment Payment Status).
   *
   * Schema coverage is partial — see `docs/REGISTRATION-DASHBOARD-GAPS.md`
   * for the full reasoning:
   * - Cash/UPI/Card/Bank Transfer: Σ `paidAmount` grouped by `paymentMode`.
   *   `CARD` is one generic enum value (no Credit/Debit split) — do NOT
   *   split this into two labels without a real field to distinguish them.
   * - Wallet Used / Loyalty Point Used: Σ `deductFromWallet` /
   *   `deductFromPoints` (deductions applied against the bill, distinct
   *   from `paymentMode`).
   * - Wallet Added / Privilege Card Added / Privilege Card Used: hardcoded
   *   `0` — no backing model exists anywhere (no wallet top-up ledger, no
   *   privilege-card transaction model — `Patient.hasPrivilegeCard` is a
   *   boolean flag only).
   * - `paymentMode = CREDIT` and `paymentMode = WALLET` rows are not summed
   *   into any bucket here (no mock label maps to them).
   * @param branchId branch scope; omitted aggregates across the whole tenant
   * @param dateMode which payments count, by `PaymentDetails.paymentDate`
   * relative to today (falling back to `PaymentDetails.createdAt` for older
   * rows written before this column was populated — confirmed 17 of 85
   * existing rows have a null `paymentDate`): `'today'` (default) = the
   * payment's date is today, `'backdated'` = before today, `'advanced-dated'`
   * = after today. Deliberately NOT `Order.orderDate` — a payment can be
   * logged on a different date than the order itself (a backdated/
   * advance-dated order, or a later settlement payment against an old order
   * via `settlePreviousDuesInTx`), and the Registration Settings' "Allow
   * Editing Payment Date" toggle (`General_AllowEditingPaymentDate`) exists
   * specifically so receptionists can set that date explicitly on the
   * Create Order payment form — confirming this is a real, user-controlled
   * business date, not an incidental timestamp.
   */
  async getCollectionsSummary(
    tenantId: string,
    branchId?: string | string[],
    createdBy?: string,
    dateMode: OrderDateMode = 'today',
  ): Promise<DashboardSlice[]> {
    const { todayStart, todayEnd } = this.getUtcTodayBounds();

    // Applied directly on PaymentDetails (via an OR against paymentDate OR,
    // when null, createdAt) rather than via the Order relation's orderDate.
    const effectiveDateWhere = (bound: { gte?: Date; lt?: Date }) => ({
      OR: [{ paymentDate: bound }, { paymentDate: null, createdAt: bound }],
    });
    const dateBound: { gte?: Date; lt?: Date } =
      dateMode === 'backdated'
        ? { lt: todayStart }
        : dateMode === 'advanced-dated'
          ? { gte: todayEnd }
          : { gte: todayStart, lt: todayEnd };

    const orderScope = {
      tenantId,
      ...branchWhere(branchId),
      deletedAt: null,
      status: { not: 'CANCELLED' as const },
      ...(createdBy ? { createdBy } : {}),
    };

    const [cash, upi, card, bankTransfer, deductions] = await Promise.all([
      this.prisma.paymentDetails.aggregate({
        where: {
          deletedAt: null,
          paymentMode: 'CASH',
          order: orderScope,
          ...effectiveDateWhere(dateBound),
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.paymentDetails.aggregate({
        where: {
          deletedAt: null,
          paymentMode: 'UPI',
          order: orderScope,
          ...effectiveDateWhere(dateBound),
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.paymentDetails.aggregate({
        where: {
          deletedAt: null,
          paymentMode: 'CARD',
          order: orderScope,
          ...effectiveDateWhere(dateBound),
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.paymentDetails.aggregate({
        where: {
          deletedAt: null,
          paymentMode: 'BANK_TRANSFER',
          order: orderScope,
          ...effectiveDateWhere(dateBound),
        },
        _sum: { paidAmount: true },
      }),
      this.prisma.paymentDetails.aggregate({
        where: {
          deletedAt: null,
          order: orderScope,
          ...effectiveDateWhere(dateBound),
        },
        _sum: { deductFromWallet: true, deductFromPoints: true },
      }),
    ]);

    return [
      { label: 'Cash', value: cash._sum.paidAmount?.toNumber() ?? 0 },
      { label: 'UPI', value: upi._sum.paidAmount?.toNumber() ?? 0 },
      { label: 'Card', value: card._sum.paidAmount?.toNumber() ?? 0 },
      {
        label: 'Bank Transfer',
        value: bankTransfer._sum.paidAmount?.toNumber() ?? 0,
      },
      { label: 'Wallet Added', value: 0 },
      {
        label: 'Wallet Used',
        value: deductions._sum.deductFromWallet?.toNumber() ?? 0,
      },
      { label: 'Privilege Card Added', value: 0 },
      { label: 'Privilege Card Used', value: 0 },
      {
        label: 'Loyalty Point Used',
        value: deductions._sum.deductFromPoints?.toNumber() ?? 0,
      },
    ];
  }

  /**
   * The Diagnostics/OPD/Radiology relation-existence filter for a `Order`
   * `where` clause (same pattern `OrderService.findAll`'s `section` filter
   * uses); `'all'`/`'pharmacy'`/`'ipd'` add no filter (Pharmacy/IPD are
   * handled by their callers reporting a fixed 0 instead).
   */
  private getModuleFilter(module: BillingsModule): Record<string, unknown> {
    return module === 'diagnostics'
      ? { diagnostics: { is: {} } }
      : module === 'opd'
        ? { opd: { is: {} } }
        : module === 'radiology'
          ? { radiology: { is: {} } }
          : {};
  }

  /**
   * UTC-midnight boundaries for "today" — `orderDate` is stored as a UTC
   * calendar date (see `OrderService`'s own
   * `todayIso = new Date().toISOString().slice(0, 10)` convention), so any
   * "today" comparison must use UTC midnight, not server-local midnight, or a
   * server running ahead of UTC (e.g. IST) would misclassify today's orders
   * for several hours after UTC midnight.
   */
  private getUtcTodayBounds(): { todayStart: Date; todayEnd: Date } {
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
    return { todayStart, todayEnd };
  }
}
