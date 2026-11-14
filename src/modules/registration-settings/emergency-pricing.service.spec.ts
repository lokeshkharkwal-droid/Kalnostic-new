import { DayOfWeek } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantTimeZoneService } from '../tenant/tenant-timezone.service';
import { RegistrationSettingsService } from './registration-settings.service';
import { EmergencyPricingService } from './emergency-pricing.service';

/**
 * Emergency Pricing = Override || (ApplyInNonOperatingHours && branch closed).
 * Branch "Test1"-style hours: 07:00–20:00 Mon–Sat, branch timezone unset →
 * tenant zone Asia/Kolkata (UTC+05:30). 2024-01-01 is a Monday.
 */
describe('EmergencyPricingService', () => {
  const MON_NOON_IST = new Date('2024-01-01T06:30:00Z'); // 12:00 IST Mon
  const MON_9PM_IST = new Date('2024-01-01T15:30:00Z'); // 21:00 IST Mon
  const SUN_NOON_IST = new Date('2024-01-07T06:30:00Z'); // 12:00 IST Sun
  const MON_11PM_IST = new Date('2024-01-01T17:30:00Z'); // 23:00 IST Mon

  const MON_SAT: DayOfWeek[] = [
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
    DayOfWeek.SATURDAY,
  ];

  const prisma = {
    branch: { findFirst: jest.fn() },
    schedule: { findFirst: jest.fn() },
  };
  const settingsService = { getForBranch: jest.fn() };
  const tz = { getTimeZone: jest.fn() };
  let service: EmergencyPricingService;

  const settings = (apply: boolean, override: boolean) =>
    settingsService.getForBranch.mockResolvedValue({
      EmergencyPricing_ApplyEmergencyPricesInNonOperatingHours: apply,
      EmergencyPricing_OverrideEmergencyPrices: override,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.branch.findFirst.mockResolvedValue({
      timezone: null,
      operationalDays: MON_SAT,
      openingTime: '07:00',
      closingTime: '20:00',
    });
    prisma.schedule.findFirst.mockResolvedValue(null);
    tz.getTimeZone.mockResolvedValue('Asia/Kolkata');
    service = new EmergencyPricingService(
      prisma as unknown as PrismaService,
      settingsService as unknown as RegistrationSettingsService,
      tz as unknown as TenantTimeZoneService,
    );
  });

  it('is inactive with both toggles off, without looking at branch hours', async () => {
    settings(false, false);
    const r = await service.resolve('t1', 'b1', MON_9PM_IST);
    expect(r).toMatchObject({
      active: false,
      reason: null,
      applyInNonOperatingHours: false,
      overrideEmergencyPrices: false,
      branchOpen: null,
      evaluatedAt: MON_9PM_IST.toISOString(),
    });
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });

  it('Override alone applies at any time, even inside operating hours', async () => {
    settings(false, true);
    const r = await service.resolve('t1', 'b1', MON_NOON_IST);
    expect(r).toMatchObject({
      active: true,
      reason: 'OVERRIDE',
      branchOpen: null,
    });
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
  });

  it('non-operating-hours toggle: inactive while the branch is open', async () => {
    settings(true, false);
    const r = await service.resolve('t1', 'b1', MON_NOON_IST);
    expect(r).toMatchObject({ active: false, reason: null, branchOpen: true });
  });

  it('non-operating-hours toggle: active after closing time (tenant timezone)', async () => {
    settings(true, false);
    const r = await service.resolve('t1', 'b1', MON_9PM_IST);
    expect(r).toMatchObject({
      active: true,
      reason: 'NON_OPERATING_HOURS',
      branchOpen: false,
    });
    expect(tz.getTimeZone).toHaveBeenCalledWith('t1');
  });

  it('non-operating-hours toggle: active on a non-operational weekday', async () => {
    settings(true, false);
    const r = await service.resolve('t1', 'b1', SUN_NOON_IST);
    expect(r).toMatchObject({ active: true, reason: 'NON_OPERATING_HOURS' });
  });

  it('never treats a branch with no operating hours configured as closed', async () => {
    settings(true, false);
    prisma.branch.findFirst.mockResolvedValue({
      timezone: null,
      operationalDays: [],
      openingTime: null,
      closingTime: null,
    });
    const r = await service.resolve('t1', 'b1', MON_9PM_IST);
    expect(r).toMatchObject({ active: false, reason: null, branchOpen: null });
  });

  it('both toggles on: Override wins the reason, hours still reported', async () => {
    settings(true, true);
    const open = await service.resolve('t1', 'b1', MON_NOON_IST);
    expect(open).toMatchObject({
      active: true,
      reason: 'OVERRIDE',
      branchOpen: true,
    });
    const closed = await service.resolve('t1', 'b1', MON_9PM_IST);
    expect(closed).toMatchObject({
      active: true,
      reason: 'OVERRIDE',
      branchOpen: false,
    });
  });

  it('prefers the active schedule shifts over the branch opening/closing time', async () => {
    settings(true, false);
    prisma.schedule.findFirst.mockResolvedValue({
      shifts: [
        {
          shiftName: 'Night',
          startTime: '22:00',
          endTime: '06:00',
          activeDays: MON_SAT,
        },
      ],
    });
    // 23:00 IST is after the branch's 20:00 closing time but inside the night shift.
    const r = await service.resolve('t1', 'b1', MON_11PM_IST);
    expect(r).toMatchObject({ active: false, branchOpen: true });
    // Noon is outside the only shift → closed.
    const noon = await service.resolve('t1', 'b1', MON_NOON_IST);
    expect(noon).toMatchObject({ active: true, branchOpen: false });
  });

  it("uses the branch's own timezone when set", async () => {
    settings(true, false);
    prisma.branch.findFirst.mockResolvedValue({
      timezone: 'UTC',
      operationalDays: MON_SAT,
      openingTime: '07:00',
      closingTime: '20:00',
    });
    // 06:30 UTC is before a 07:00 UTC opening (it is noon in IST).
    const r = await service.resolve('t1', 'b1', MON_NOON_IST);
    expect(r).toMatchObject({ active: true, branchOpen: false });
    expect(tz.getTimeZone).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ''])(
    'is inactive without an active branch (%p, business tier)',
    async (branchId) => {
      const r = await service.resolve('t1', branchId, MON_9PM_IST);
      expect(r.active).toBe(false);
      expect(settingsService.getForBranch).not.toHaveBeenCalled();
    },
  );
});
