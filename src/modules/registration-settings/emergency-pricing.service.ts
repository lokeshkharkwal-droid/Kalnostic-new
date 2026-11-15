import { Injectable } from '@nestjs/common';
import { ScheduleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BranchOpenInputs,
  hasBranchOperatingHours,
  isBranchOpenAt,
} from '../../common/utils/branch-open.util';
import {
  WorkingShift,
  toBranchLocalInstant,
} from '../../common/utils/tat-working-time.util';
import { ScheduleShift } from '../schedule/entities/schedule.entity';
import { TenantTimeZoneService } from '../tenant/tenant-timezone.service';
import { RegistrationSettingsService } from './registration-settings.service';
import { EmergencyPricingStatus } from './entities/emergency-pricing.entity';

/**
 * Resolves whether emergency pricing applies to a branch at an instant
 * (Registration Settings → Emergency Pricing). The two toggles are independent
 * and combine as:
 *
 *   active = Override || (ApplyInNonOperatingHours && branch closed at `at`)
 *
 * "Closed" uses the same source as the NABL TAT engine: the branch's ACTIVE
 * `Schedule` shifts, else its `operationalDays` + `openingTime`/`closingTime`
 * ({@link isBranchOpenAt}). A branch with no operating hours configured is never
 * considered closed here (otherwise turning the toggle on would emergency-price
 * every order). Shift times are branch-local: the branch timezone is used, else
 * the tenant's (`TenantTimeZoneService`, default Asia/Kolkata).
 */
@Injectable()
export class EmergencyPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrationSettingsService: RegistrationSettingsService,
    private readonly tenantTimeZoneService: TenantTimeZoneService,
  ) {}

  /**
   * Resolve the branch's emergency-pricing state at `at`.
   * @param tenantId tenant scope
   * @param branchId active branch; null/empty (business tier) → inactive
   * @param at the instant to evaluate (defaults to now)
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async resolve(
    tenantId: string,
    branchId: string | null | undefined,
    at: Date = new Date(),
  ): Promise<EmergencyPricingStatus> {
    const evaluatedAt = at.toISOString();
    if (!branchId) {
      return {
        active: false,
        reason: null,
        applyInNonOperatingHours: false,
        overrideEmergencyPrices: false,
        branchOpen: null,
        evaluatedAt,
      };
    }

    const settings = await this.registrationSettingsService.getForBranch(
      tenantId,
      branchId,
    );
    const overrideEmergencyPrices =
      settings.EmergencyPricing_OverrideEmergencyPrices;
    const applyInNonOperatingHours =
      settings.EmergencyPricing_ApplyEmergencyPricesInNonOperatingHours;

    const branchOpen = applyInNonOperatingHours
      ? await this.isBranchOpen(tenantId, branchId, at)
      : null;

    const nonOperating = applyInNonOperatingHours && branchOpen === false;
    const active = overrideEmergencyPrices || nonOperating;
    return {
      active,
      reason: overrideEmergencyPrices
        ? 'OVERRIDE'
        : nonOperating
          ? 'NON_OPERATING_HOURS'
          : null,
      applyInNonOperatingHours,
      overrideEmergencyPrices,
      branchOpen,
      evaluatedAt,
    };
  }

  /**
   * Whether the branch is inside its operating hours at `at`; null when the
   * branch has no operating hours configured at all.
   */
  private async isBranchOpen(
    tenantId: string,
    branchId: string,
    at: Date,
  ): Promise<boolean | null> {
    const [branch, shifts] = await Promise.all([
      this.prisma.branch.findFirst({
        where: { id: branchId, tenantId, deletedAt: null },
        select: {
          timezone: true,
          operationalDays: true,
          openingTime: true,
          closingTime: true,
        },
      }),
      this.loadActiveShifts(tenantId, branchId, at),
    ]);
    if (!branch) return null;

    const inputs: BranchOpenInputs = {
      shifts,
      operationalDays: branch.operationalDays,
      openingTime: branch.openingTime,
      closingTime: branch.closingTime,
    };
    if (!hasBranchOperatingHours(inputs)) return null;

    const timezone =
      branch.timezone ||
      (await this.tenantTimeZoneService.getTimeZone(tenantId));
    return isBranchOpenAt(toBranchLocalInstant(at, timezone), inputs);
  }

  /**
   * The branch's ACTIVE schedule shifts covering `at`, in engine shape (same
   * query + mapping as `TatService.loadCalendar`). Empty when there is no
   * active schedule — {@link isBranchOpenAt} then falls back to the branch's
   * opening/closing time.
   */
  private async loadActiveShifts(
    tenantId: string,
    branchId: string,
    at: Date,
  ): Promise<WorkingShift[]> {
    const schedule = await this.prisma.schedule.findFirst({
      where: {
        tenantId,
        branchId,
        status: ScheduleStatus.ACTIVE,
        deletedAt: null,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { shifts: true },
    });
    const rawShifts =
      (schedule?.shifts as unknown as ScheduleShift[] | null) ?? [];
    return rawShifts.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      activeDays: s.activeDays,
      breaks:
        s.breakStartTime &&
        s.breakEndTime &&
        s.breakStartTime !== s.breakEndTime
          ? [{ startTime: s.breakStartTime, endTime: s.breakEndTime }]
          : [],
    }));
  }
}
