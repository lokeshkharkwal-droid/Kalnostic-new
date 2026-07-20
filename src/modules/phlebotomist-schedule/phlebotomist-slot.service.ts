import { Injectable } from '@nestjs/common';
import { PhlebotomistSlot, PhlebotomistScheduleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { PhlebotomistDirectoryService } from './phlebotomist-directory.service';
import {
  AvailabilityDay,
  AvailabilityDayStatus,
  AvailabilitySlot,
  CalendarDay,
  CalendarPhlebotomistInfo,
  CalendarResponse,
  CalendarSlot,
  DayAvailabilityStatus,
  PhlebotomistAvailability,
  PhlebotomistCurrentStatus,
  SlotDisplayStatus,
  TodaySlot,
} from './entities/phlebotomist-schedule.entity';
import { InvalidPhlebScheduleConfigException } from './exceptions/phlebotomist-schedule.exceptions';
import {
  addDays,
  dayNameOf,
  formatDate,
  isSunday,
  maskMobile,
  startOfUtcDay,
  toMinutes,
  toUtcDateOnly,
  utcMinutesOf,
} from './utils/schedule-time.util';

/** Default look-ahead (weeks) when the availability range is unbounded. */
const DEFAULT_HORIZON_WEEKS = 8;

/** Hard cap on the availability window to bound the response payload. */
const MAX_AVAILABILITY_DAYS = 70;

/** A slot with the booked count derived from visits for the same window. */
interface DerivedSlot extends PhlebotomistSlot {
  bookedCount: number;
}

/**
 * Read model over generated `PhlebotomistSlot`s: the weekly calendar and today's
 * slots. Tenant-scoped + branch-level (CLAUDE.md §4.7): every query carries
 * `tenantId`/`branchId` and filters soft-deleted rows.
 *
 * Occupancy is **derived at read time** — a slot's booked count is the number of
 * non-cancelled `OrderDiagnostics` visits whose time falls in the slot window
 * (never a stored counter). Display state (`Past`, `Full`, `Booked`, `Available`)
 * and per-day availability (`Off-duty` on Sundays, `Unavailable` with no slots)
 * are derived too, so previous/next week needs no frontend logic.
 */
@Injectable()
export class PhlebotomistSlotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: PhlebotomistDirectoryService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Build the 7-day calendar for a phlebotomist starting at `weekStart`, with the
   * phlebotomist header and each day's slots. Previous/next week is served by
   * passing a different `weekStart`.
   * @throws PhlebotomistNotFoundException if not an active phlebotomist at the branch
   */
  async getCalendar(
    tenantId: string,
    branchId: string,
    phlebotomistId: string,
    weekStart: string,
  ): Promise<CalendarResponse> {
    const person = await this.directory.assertActivePhlebotomist(
      tenantId,
      branchId,
      phlebotomistId,
    );

    const start = toUtcDateOnly(weekStart);
    const end = addDays(start, 7);
    const slots = await this.prisma.phlebotomistSlot.findMany({
      where: {
        tenantId,
        branchId,
        phlebotomistId,
        deletedAt: null,
        slotDate: { gte: start, lt: end },
      },
      orderBy: [{ slotDate: 'asc' }, { startTime: 'asc' }],
    });
    const visits = await this.directory.visitTimesInRange(
      tenantId,
      branchId,
      phlebotomistId,
      start,
      end,
    );
    const minutesByDate = this.bucketVisits(visits);

    // Configured daily cap (drives per-day remaining + the header). `null` when
    // the phlebotomist has no active schedule; `0` means "no cap".
    const schedule = await this.prisma.phlebotomistSchedule.findFirst({
      where: {
        tenantId,
        branchId,
        phlebotomistId,
        status: PhlebotomistScheduleStatus.ACTIVE,
        deletedAt: null,
      },
      select: { maxVisitsPerDay: true },
      orderBy: { createdAt: 'desc' },
    });
    const maxVisitsPerDay = schedule?.maxVisitsPerDay ?? null;

    const byDate = new Map<string, DerivedSlot[]>();
    for (const slot of slots) {
      const key = formatDate(slot.slotDate);
      const list = byDate.get(key) ?? [];
      list.push({ ...slot, bookedCount: this.bookedFor(slot, minutesByDate) });
      byDate.set(key, list);
    }

    const now = new Date();
    let totalBookings = 0;
    const days: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const dateStr = formatDate(date);
      const daySlots = byDate.get(dateStr) ?? [];
      const bookedVisits = daySlots.reduce((sum, s) => sum + s.bookedCount, 0);
      totalBookings += bookedVisits;
      days.push({
        date: dateStr,
        dayName: dayNameOf(date),
        availabilityStatus: this.dayStatus(date, daySlots.length),
        bookedVisits,
        maxVisitsPerDay,
        remaining:
          maxVisitsPerDay && maxVisitsPerDay > 0
            ? Math.max(0, maxVisitsPerDay - bookedVisits)
            : null,
        slots: daySlots.map((s) => this.toCalendarSlot(s, now)),
      });
    }

    return {
      phlebotomist: await this.buildInfo(
        tenantId,
        branchId,
        phlebotomistId,
        person,
      ),
      weekStart: formatDate(start),
      totalBookings,
      days,
    };
  }

  /**
   * Return today's slots for a phlebotomist, with the occupancy ratio (`"2 / 5"`)
   * and a derived availability status (past slots `Past`, full slots `Full`).
   * @throws PhlebotomistNotFoundException if not an active phlebotomist at the branch
   */
  async getTodaySlots(
    tenantId: string,
    branchId: string,
    phlebotomistId: string,
  ): Promise<TodaySlot[]> {
    await this.directory.assertActivePhlebotomist(
      tenantId,
      branchId,
      phlebotomistId,
    );
    const today = startOfUtcDay(new Date());
    const tomorrow = addDays(today, 1);
    const slots = await this.prisma.phlebotomistSlot.findMany({
      where: {
        tenantId,
        branchId,
        phlebotomistId,
        deletedAt: null,
        slotDate: today,
      },
      orderBy: { startTime: 'asc' },
    });
    const visits = await this.directory.visitTimesInRange(
      tenantId,
      branchId,
      phlebotomistId,
      today,
      tomorrow,
    );
    const minutesByDate = this.bucketVisits(visits);
    const now = new Date();
    return slots.map((s) => {
      const booked = this.bookedFor(s, minutesByDate);
      return {
        slotId: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        bookedCount: booked,
        maxCapacity: s.slotCapacity,
        occupancyRatio: `${booked} / ${s.slotCapacity}`,
        occupancyPercentage: this.occupancy(booked, s.slotCapacity),
        availabilityStatus: this.deriveStatus(s, booked, now),
      };
    });
  }

  /**
   * Compute a phlebotomist's home-visit availability across `[from, to)` for the
   * create-order collection picker. Each date reports whether it is `selectable`
   * (and why not) plus its bookable time slots — reusing the same derived
   * occupancy as the calendar. `from`/`to` default to today through the generated
   * horizon; the window is capped at {@link MAX_AVAILABILITY_DAYS} days.
   *
   * `serviceType` is intentionally not filtered: any ACTIVE schedule the
   * phlebotomist has (HOME_COLLECTION or IN_CENTER) drives their availability.
   * @throws PhlebotomistNotFoundException if not an active phlebotomist at the branch
   * @throws InvalidPhlebScheduleConfigException if the range is empty or too wide
   */
  async getAvailability(
    tenantId: string,
    branchId: string,
    phlebotomistId: string,
    from?: string,
    to?: string,
  ): Promise<PhlebotomistAvailability> {
    await this.directory.assertActivePhlebotomist(
      tenantId,
      branchId,
      phlebotomistId,
    );

    const today = startOfUtcDay(new Date());
    const start = from ? toUtcDateOnly(from) : today;
    const end = to
      ? toUtcDateOnly(to)
      : addDays(today, DEFAULT_HORIZON_WEEKS * 7);
    if (end <= start) {
      throw new InvalidPhlebScheduleConfigException(
        'The availability range end must be after its start',
        { from, to },
      );
    }
    const spanDays = Math.round(
      (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (spanDays > MAX_AVAILABILITY_DAYS) {
      throw new InvalidPhlebScheduleConfigException(
        `The availability range must not exceed ${MAX_AVAILABILITY_DAYS} days`,
        { from, to, spanDays },
      );
    }

    // Active schedule supplies the daily cap and the holiday/day-off reasons.
    const schedule = await this.prisma.phlebotomistSchedule.findFirst({
      where: {
        tenantId,
        branchId,
        phlebotomistId,
        status: PhlebotomistScheduleStatus.ACTIVE,
        deletedAt: null,
      },
      include: {
        holidays: { where: { deletedAt: null } },
        overrides: { where: { deletedAt: null } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const hasSchedule = schedule !== null;
    const holidaySet = new Set(
      (schedule?.holidays ?? []).map((h) => formatDate(h.holidayDate)),
    );
    const maxVisitsPerDay = schedule?.maxVisitsPerDay ?? 0;

    const slots = await this.prisma.phlebotomistSlot.findMany({
      where: {
        tenantId,
        branchId,
        phlebotomistId,
        deletedAt: null,
        slotDate: { gte: start, lt: end },
      },
      orderBy: [{ slotDate: 'asc' }, { startTime: 'asc' }],
    });
    const visits = await this.directory.visitTimesInRange(
      tenantId,
      branchId,
      phlebotomistId,
      start,
      end,
    );
    const minutesByDate = this.bucketVisits(visits);

    const byDate = new Map<string, DerivedSlot[]>();
    for (const slot of slots) {
      const key = formatDate(slot.slotDate);
      const list = byDate.get(key) ?? [];
      list.push({ ...slot, bookedCount: this.bookedFor(slot, minutesByDate) });
      byDate.set(key, list);
    }

    const now = new Date();
    const days: AvailabilityDay[] = [];
    for (let d = start; d < end; d = addDays(d, 1)) {
      const dateStr = formatDate(d);
      days.push(
        this.toAvailabilityDay(d, dateStr, byDate.get(dateStr) ?? [], now, {
          hasSchedule,
          holiday: holidaySet.has(dateStr),
          maxVisitsPerDay,
        }),
      );
    }

    return {
      phlebotomistId,
      hasSchedule,
      rangeStart: formatDate(start),
      rangeEnd: formatDate(end),
      days,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Shape one calendar date for the availability picker: derive each slot's
   * selectability (capacity left, not past, daily cap not reached) and the day's
   * overall status + human reason.
   */
  private toAvailabilityDay(
    date: Date,
    dateStr: string,
    slots: DerivedSlot[],
    now: Date,
    ctx: {
      hasSchedule: boolean;
      holiday: boolean;
      maxVisitsPerDay: number;
    },
  ): AvailabilityDay {
    const bookedVisits = slots.reduce((sum, s) => sum + s.bookedCount, 0);
    const maxReached =
      ctx.maxVisitsPerDay > 0 && bookedVisits >= ctx.maxVisitsPerDay;

    const availSlots: AvailabilitySlot[] = slots.map((s) => {
      const status = this.deriveStatus(s, s.bookedCount, now);
      const hasCapacity = status === 'Available' || status === 'Booked';
      return {
        slotId: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        capacity: s.slotCapacity,
        booked: s.bookedCount,
        available: Math.max(0, s.slotCapacity - s.bookedCount),
        status,
        selectable: hasCapacity && !maxReached,
      };
    });

    const { status, reason } = this.deriveDayStatus(
      date,
      availSlots,
      now,
      ctx,
      maxReached,
    );
    return {
      date: dateStr,
      dayName: dayNameOf(date),
      status,
      selectable: status === 'available',
      reason,
      maxVisitsPerDay: ctx.maxVisitsPerDay,
      bookedVisits,
      slots: availSlots,
    };
  }

  /**
   * Resolve a date's availability status and the reason to show when it is not
   * bookable. Priority: elapsed → no schedule → holiday/leave → not a working day
   * → fully booked / cap reached → available.
   */
  private deriveDayStatus(
    date: Date,
    slots: AvailabilitySlot[],
    now: Date,
    ctx: { hasSchedule: boolean; holiday: boolean },
    maxReached: boolean,
  ): { status: AvailabilityDayStatus; reason: string | null } {
    if (date < startOfUtcDay(now)) {
      return { status: 'past', reason: 'This date has already passed' };
    }
    if (!ctx.hasSchedule) {
      return {
        status: 'no-schedule',
        reason: 'This phlebotomist has no active schedule',
      };
    }
    if (ctx.holiday) {
      return {
        status: 'holiday',
        reason: 'Phlebotomist is on leave / holiday',
      };
    }
    if (slots.length === 0) {
      return {
        status: 'off-day',
        reason: 'Phlebotomist is not scheduled on this day',
      };
    }
    if (slots.some((s) => s.selectable)) {
      return { status: 'available', reason: null };
    }
    if (maxReached) {
      return {
        status: 'fully-booked',
        reason: 'Maximum home visits for this day reached',
      };
    }
    if (slots.every((s) => s.status === 'Past')) {
      return {
        status: 'fully-booked',
        reason: 'No remaining time slots for this day',
      };
    }
    return {
      status: 'fully-booked',
      reason: 'All time slots are fully booked',
    };
  }

  /** Build the calendar header for the phlebotomist from their active schedule. */
  private async buildInfo(
    tenantId: string,
    branchId: string,
    phlebotomistId: string,
    person: {
      id: string;
      firstName: string;
      lastName: string | null;
      phone: string | null;
    },
  ): Promise<CalendarPhlebotomistInfo> {
    const schedule = await this.prisma.phlebotomistSchedule.findFirst({
      where: {
        tenantId,
        branchId,
        phlebotomistId,
        status: PhlebotomistScheduleStatus.ACTIVE,
        deletedAt: null,
      },
      include: {
        zones: { where: { deletedAt: null }, include: { zone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const branch = await this.branchService.findById(branchId, tenantId);

    const today = startOfUtcDay(new Date());
    const [assigned, completed, onRoute, tenure] = await Promise.all([
      this.directory.countVisits(
        tenantId,
        branchId,
        [phlebotomistId],
        'assigned',
      ),
      this.directory.countVisits(
        tenantId,
        branchId,
        [phlebotomistId],
        'completed',
      ),
      this.directory.onRoutePersonIds(
        tenantId,
        branchId,
        [phlebotomistId],
        today,
        addDays(today, 1),
      ),
      this.directory.tenureYears(tenantId, phlebotomistId),
    ]);
    const assignedCount = assigned.get(phlebotomistId) ?? 0;
    const completedCount = completed.get(phlebotomistId) ?? 0;
    const zoneNames = (schedule?.zones ?? [])
      .map((z) => z.zone.name)
      .filter(Boolean);

    return {
      id: person.id,
      name: [person.firstName, person.lastName].filter(Boolean).join(' '),
      mobile: maskMobile(person.phone),
      serviceType: schedule?.serviceType ?? null,
      branch: branch.name,
      zone: zoneNames.length > 0 ? zoneNames.join(', ') : null,
      yearsOfExperience: tenure,
      completedVisitRatio: `${completedCount} / ${assignedCount}`,
      currentStatus: this.currentStatus(true, onRoute.has(phlebotomistId)),
      maxVisitsPerDay: schedule?.maxVisitsPerDay ?? null,
    };
  }

  /** Group visit timestamps into minutes-since-midnight, keyed by UTC date. */
  private bucketVisits(visits: Date[]): Map<string, number[]> {
    const byDate = new Map<string, number[]>();
    for (const v of visits) {
      const key = formatDate(v);
      const list = byDate.get(key) ?? [];
      list.push(utcMinutesOf(v));
      byDate.set(key, list);
    }
    return byDate;
  }

  /** Booked count for a slot = visits whose minute falls in `[start, end)`. */
  private bookedFor(
    slot: PhlebotomistSlot,
    minutesByDate: Map<string, number[]>,
  ): number {
    const mins = minutesByDate.get(formatDate(slot.slotDate));
    if (!mins) return 0;
    const start = toMinutes(slot.startTime);
    const end = toMinutes(slot.endTime);
    return mins.filter((m) => m >= start && m < end).length;
  }

  /** Shape a slot for the calendar grid, deriving its display status. */
  private toCalendarSlot(slot: DerivedSlot, now: Date): CalendarSlot {
    return {
      slotId: slot.id,
      startTime: slot.startTime,
      endTime: slot.endTime,
      totalCapacity: slot.slotCapacity,
      bookedCount: slot.bookedCount,
      availableCount: Math.max(0, slot.slotCapacity - slot.bookedCount),
      occupancyPercentage: this.occupancy(slot.bookedCount, slot.slotCapacity),
      status: this.deriveStatus(slot, slot.bookedCount, now),
    };
  }

  /** Occupancy percentage (0–100), rounded. */
  private occupancy(booked: number, capacity: number): number {
    if (capacity <= 0) return 0;
    return Math.min(100, Math.round((booked / capacity) * 100));
  }

  /** Per-day availability: Sunday off-duty, days with slots available, else unavailable. */
  private dayStatus(date: Date, slotCount: number): DayAvailabilityStatus {
    if (slotCount > 0) return 'Available';
    if (isSunday(date)) return 'Off-duty';
    return 'Unavailable';
  }

  /**
   * Derive a slot's display status: `Past` once elapsed, else `Full` at capacity,
   * `Booked` when partially booked, `Available` otherwise.
   */
  private deriveStatus(
    slot: PhlebotomistSlot,
    booked: number,
    now: Date,
  ): SlotDisplayStatus {
    if (this.isPast(slot, now)) return 'Past';
    if (booked >= slot.slotCapacity) return 'Full';
    if (booked > 0) return 'Booked';
    return 'Available';
  }

  /** True once the slot's end time has elapsed (compared in UTC). */
  private isPast(slot: PhlebotomistSlot, now: Date): boolean {
    const endMinutes = toMinutes(slot.endTime);
    const slotEnd = new Date(slot.slotDate.getTime() + endMinutes * 60_000);
    return slotEnd.getTime() <= now.getTime();
  }

  /** Map active flag + on-route flag to the live status label. */
  private currentStatus(
    isActive: boolean,
    onRoute: boolean,
  ): PhlebotomistCurrentStatus {
    if (!isActive) return 'Inactive';
    return onRoute ? 'On Route' : 'Available';
  }
}
