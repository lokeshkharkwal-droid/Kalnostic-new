import { Injectable } from '@nestjs/common';
import {
  DayOfWeek,
  PhleboServiceType,
  PhlebotomistScheduleStatus,
  Prisma,
  RecurrencePattern,
  SlotStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PhlebotomistDirectoryService } from './phlebotomist-directory.service';
import { ServiceZoneService } from './service-zone.service';
import { CreatePhlebotomistScheduleDto } from './dto/create-phlebotomist-schedule.dto';
import { UpdatePhlebotomistScheduleDto } from './dto/update-phlebotomist-schedule.dto';
import { ScheduleHolidayDto } from './dto/schedule-holiday.dto';
import { ScheduleOverrideDto } from './dto/schedule-override.dto';
import {
  PHLEBOTOMIST_SCHEDULE_DETAIL_INCLUDE,
  PhlebotomistScheduleDetail,
} from './entities/phlebotomist-schedule.entity';
import {
  InvalidPhlebScheduleConfigException,
  PhlebScheduleHasBookingsException,
  PhlebotomistScheduleForStaffNotFoundException,
  PhlebotomistScheduleNotFoundException,
  PhlebotomistScheduleOverlapException,
} from './exceptions/phlebotomist-schedule.exceptions';
import {
  addDays,
  dayOfWeekOf,
  formatDate,
  fromMinutes,
  isSunday,
  startOfUtcDay,
  toMinutes,
  toUtcDateOnly,
  utcMinutesOf,
} from './utils/schedule-time.util';

/** Default number of weeks ahead to generate slots for. */
const DEFAULT_HORIZON_WEEKS = 8;

/** A schedule's timing/recurrence resolved into the shape slot generation uses. */
interface ResolvedConfig {
  startTime: string;
  endTime: string;
  intervalMinutes: number;
  travelBufferMinutes: number;
  maxVisitsPerDay: number;
  slotCapacity: number;
  recurrencePattern: RecurrencePattern;
  selectedDays: DayOfWeek[];
  serviceType: PhleboServiceType;
  status: PhlebotomistScheduleStatus;
}

/**
 * Phlebotomist schedule configuration + slot generation. Tenant-scoped **and**
 * branch-level (CLAUDE.md §4.5–4.7): every query carries `tenantId` (defence in
 * depth on top of RLS) and filters soft-deleted rows. The `phlebotomistId` (a
 * staff Person, not a master row) and the service zones are validated against the
 * caller's tenant/branch via injected services (rule #3). `branchId` comes from
 * the JWT context, never the body.
 *
 * Slots are a generated skeleton — occupancy is derived at read time from
 * `OrderDiagnostics` visits, not stored. Regeneration only ever touches
 * **future, unbooked** slots: a future slot whose window contains a visit is
 * retained, so booked visits are never removed automatically. Past slots are
 * never modified. Sunday is off-duty unless a date override supplies a window.
 */
@Injectable()
export class PhlebotomistScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: PhlebotomistDirectoryService,
    private readonly serviceZoneService: ServiceZoneService,
  ) {}

  /**
   * Create a phlebotomist schedule and generate its future slots (when ACTIVE),
   * all in one transaction. Validates the phlebotomist and zones belong to the
   * caller's branch, checks the config, and enforces the one-active-schedule-per-
   * phlebotomist+branch rule.
   * @param tenantId tenant scope (from the JWT)
   * @param branchId active branch (from the JWT profile)
   * @param dto validated schedule payload
   * @param actorId person id of the creator (audit trail)
   * @returns the created schedule with its days/zones/holidays/overrides
   * @throws PhlebotomistNotFoundException / InvalidServiceZonesException on bad ids
   * @throws InvalidPhlebScheduleConfigException on a bad config
   * @throws PhlebotomistScheduleOverlapException if an active schedule exists
   */
  async create(
    tenantId: string,
    branchId: string,
    dto: CreatePhlebotomistScheduleDto,
    actorId?: string,
  ): Promise<PhlebotomistScheduleDetail> {
    await this.directory.assertActivePhlebotomist(
      tenantId,
      branchId,
      dto.phlebotomistId,
    );
    const zoneIds = dto.zoneIds ?? [];
    await this.serviceZoneService.assertValidZones(tenantId, branchId, zoneIds);

    const config = this.resolveConfigFromCreate(dto);
    this.validateConfig(config);

    const status = dto.status ?? PhlebotomistScheduleStatus.ACTIVE;
    if (status === PhlebotomistScheduleStatus.ACTIVE) {
      await this.assertNoActiveSchedule(tenantId, dto.phlebotomistId, branchId);
    }

    return this.prisma.withTenant(tenantId, async (tx) => {
      const schedule = await tx.phlebotomistSchedule.create({
        data: {
          tenantId,
          branchId,
          phlebotomistId: dto.phlebotomistId,
          serviceType: dto.serviceType,
          status,
          startTime: dto.startTime,
          endTime: dto.endTime,
          intervalMinutes: dto.intervalMinutes,
          travelBufferMinutes: dto.travelBufferMinutes ?? 0,
          maxVisitsPerDay: dto.maxVisitsPerDay,
          slotCapacity: dto.slotCapacity,
          recurrencePattern: dto.recurrencePattern,
          createdBy: actorId ?? null,
          updatedBy: actorId ?? null,
          days: { create: this.dayCreates(tenantId, config) },
          zones: { create: this.zoneCreates(tenantId, zoneIds) },
          holidays: { create: this.holidayCreates(tenantId, dto.holidays) },
          overrides: { create: this.overrideCreates(tenantId, dto.overrides) },
        },
        include: PHLEBOTOMIST_SCHEDULE_DETAIL_INCLUDE,
      });

      if (status === PhlebotomistScheduleStatus.ACTIVE) {
        await this.regenerateFutureSlots(
          tx,
          tenantId,
          branchId,
          dto.phlebotomistId,
          schedule.id,
          config,
          dto.holidays ?? [],
          dto.overrides ?? [],
          dto.horizonWeeks ?? DEFAULT_HORIZON_WEEKS,
        );
      }

      return schedule;
    });
  }

  /**
   * Fetch a phlebotomist's single ACTIVE schedule with its children (hydrates the
   * Configure form). Falls back to the most recent non-deleted schedule.
   * @throws PhlebotomistScheduleForStaffNotFoundException if none exists
   */
  async findByPhlebotomist(
    tenantId: string,
    branchId: string,
    phlebotomistId: string,
  ): Promise<PhlebotomistScheduleDetail> {
    const active = await this.prisma.phlebotomistSchedule.findFirst({
      where: {
        tenantId,
        branchId,
        phlebotomistId,
        status: PhlebotomistScheduleStatus.ACTIVE,
        deletedAt: null,
      },
      include: PHLEBOTOMIST_SCHEDULE_DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    if (active) return active;

    const latest = await this.prisma.phlebotomistSchedule.findFirst({
      where: { tenantId, branchId, phlebotomistId, deletedAt: null },
      include: PHLEBOTOMIST_SCHEDULE_DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) {
      throw new PhlebotomistScheduleForStaffNotFoundException(phlebotomistId);
    }
    return latest;
  }

  /**
   * Fetch one schedule by id, scoped to tenant + branch, with its children.
   * @throws PhlebotomistScheduleNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<PhlebotomistScheduleDetail> {
    const schedule = await this.prisma.phlebotomistSchedule.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
      include: PHLEBOTOMIST_SCHEDULE_DETAIL_INCLUDE,
    });
    if (!schedule) {
      throw new PhlebotomistScheduleNotFoundException(id);
    }
    return schedule;
  }

  /**
   * Update a schedule. Only supplied fields change; `phlebotomistId`/`branchId`
   * are immutable. Children (`days`/`zones`/`holidays`/`overrides`) are replaced
   * when supplied. When the effective config or status changes, **future
   * unbooked** slots are regenerated (past and booked slots are never touched).
   * @throws PhlebotomistScheduleNotFoundException / InvalidPhlebScheduleConfigException /
   *   PhlebotomistScheduleOverlapException / InvalidServiceZonesException
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    dto: UpdatePhlebotomistScheduleDto,
    actorId?: string,
  ): Promise<PhlebotomistScheduleDetail> {
    const existing = await this.findById(id, tenantId, branchId);

    const config = this.resolveConfigFromUpdate(existing, dto);
    this.validateConfig(config);

    if (dto.zoneIds !== undefined) {
      await this.serviceZoneService.assertValidZones(
        tenantId,
        branchId,
        dto.zoneIds,
      );
    }

    const status = dto.status ?? existing.status;
    if (status === PhlebotomistScheduleStatus.ACTIVE) {
      await this.assertNoActiveSchedule(
        tenantId,
        existing.phlebotomistId,
        branchId,
        id,
      );
    }

    const holidays: ScheduleHolidayDto[] =
      dto.holidays ??
      existing.holidays.map((h) => ({
        date: formatDate(h.holidayDate),
        remarks: h.remarks ?? undefined,
      }));
    const overrides: ScheduleOverrideDto[] =
      dto.overrides ??
      existing.overrides.map((o) => ({
        date: formatDate(o.overrideDate),
        startTime: o.startTime ?? undefined,
        endTime: o.endTime ?? undefined,
      }));

    return this.prisma.withTenant(tenantId, async (tx) => {
      const data: Prisma.PhlebotomistScheduleUpdateInput = {};
      if (dto.serviceType !== undefined) data.serviceType = dto.serviceType;
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.startTime !== undefined) data.startTime = dto.startTime;
      if (dto.endTime !== undefined) data.endTime = dto.endTime;
      if (dto.intervalMinutes !== undefined) {
        data.intervalMinutes = dto.intervalMinutes;
      }
      if (dto.travelBufferMinutes !== undefined) {
        data.travelBufferMinutes = dto.travelBufferMinutes;
      }
      if (dto.maxVisitsPerDay !== undefined) {
        data.maxVisitsPerDay = dto.maxVisitsPerDay;
      }
      if (dto.slotCapacity !== undefined) data.slotCapacity = dto.slotCapacity;
      if (dto.recurrencePattern !== undefined) {
        data.recurrencePattern = dto.recurrencePattern;
      }
      if (actorId !== undefined) data.updatedBy = actorId;

      // Regenerated child config is replaced wholesale. The new rows reuse the
      // same unique keys ((scheduleId, dayOfWeek), (scheduleId, zoneId)), so the
      // previous rows must be hard-deleted — soft-deleting would leave the unique
      // key occupied and the re-create would collide. Reads already filter
      // deletedAt: null, so nothing depended on retaining these rows.
      if (
        dto.selectedDays !== undefined ||
        dto.recurrencePattern !== undefined
      ) {
        await tx.phlebotomistScheduleDay.deleteMany({
          where: { scheduleId: id, tenantId },
        });
        data.days = { create: this.dayCreates(tenantId, config) };
      }
      if (dto.zoneIds !== undefined) {
        await tx.phlebotomistScheduleZone.deleteMany({
          where: { scheduleId: id, tenantId },
        });
        data.zones = { create: this.zoneCreates(tenantId, dto.zoneIds) };
      }
      if (dto.holidays !== undefined) {
        await tx.phlebotomistScheduleHoliday.deleteMany({
          where: { scheduleId: id, tenantId },
        });
        data.holidays = { create: this.holidayCreates(tenantId, dto.holidays) };
      }
      if (dto.overrides !== undefined) {
        await tx.phlebotomistScheduleOverride.deleteMany({
          where: { scheduleId: id, tenantId },
        });
        data.overrides = {
          create: this.overrideCreates(tenantId, dto.overrides),
        };
      }

      const schedule = await tx.phlebotomistSchedule.update({
        where: { id },
        data,
        include: PHLEBOTOMIST_SCHEDULE_DETAIL_INCLUDE,
      });

      if (status === PhlebotomistScheduleStatus.ACTIVE) {
        await this.regenerateFutureSlots(
          tx,
          tenantId,
          branchId,
          existing.phlebotomistId,
          id,
          config,
          holidays,
          overrides,
          dto.horizonWeeks ?? DEFAULT_HORIZON_WEEKS,
        );
      } else {
        await this.softDeleteFutureUnbookedSlots(
          tx,
          tenantId,
          branchId,
          id,
          existing.phlebotomistId,
        );
      }

      return schedule;
    });
  }

  /**
   * Soft-delete a schedule. Only allowed when it has no **future booked** slots
   * (booked visits are never removed automatically). Its future unbooked slots
   * and child rows are soft-deleted alongside it.
   * @throws PhlebotomistScheduleNotFoundException if missing
   * @throws PhlebScheduleHasBookingsException if future booked slots exist
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<PhlebotomistScheduleDetail> {
    const schedule = await this.findById(id, tenantId, branchId);
    const today = startOfUtcDay(new Date());
    const horizonEnd = addDays(today, DEFAULT_HORIZON_WEEKS * 7);

    const futureSlots = await this.prisma.phlebotomistSlot.findMany({
      where: {
        scheduleId: id,
        tenantId,
        deletedAt: null,
        slotDate: { gte: today },
      },
      select: { slotDate: true, startTime: true, endTime: true },
    });
    const visits = await this.directory.visitTimesInRange(
      tenantId,
      branchId,
      schedule.phlebotomistId,
      today,
      horizonEnd,
    );
    const bookedKeys = this.bookedSlotKeys(futureSlots, visits);
    if (bookedKeys.size > 0) {
      throw new PhlebScheduleHasBookingsException(id, bookedKeys.size);
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      const now = new Date();
      await this.softDeleteFutureUnbookedSlots(
        tx,
        tenantId,
        branchId,
        id,
        schedule.phlebotomistId,
      );
      await tx.phlebotomistScheduleDay.updateMany({
        where: { scheduleId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.phlebotomistScheduleZone.updateMany({
        where: { scheduleId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.phlebotomistScheduleHoliday.updateMany({
        where: { scheduleId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.phlebotomistScheduleOverride.updateMany({
        where: { scheduleId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.phlebotomistSchedule.update({
        where: { id },
        data: { deletedAt: now },
      });
    });

    return schedule;
  }

  // ── Config resolution & validation ────────────────────────────────────────

  /** Build the resolved config from a create DTO. */
  private resolveConfigFromCreate(
    dto: CreatePhlebotomistScheduleDto,
  ): ResolvedConfig {
    return {
      startTime: dto.startTime,
      endTime: dto.endTime,
      intervalMinutes: dto.intervalMinutes,
      travelBufferMinutes: dto.travelBufferMinutes ?? 0,
      maxVisitsPerDay: dto.maxVisitsPerDay,
      slotCapacity: dto.slotCapacity,
      recurrencePattern: dto.recurrencePattern,
      selectedDays: dto.selectedDays ?? [],
      serviceType: dto.serviceType,
      status: dto.status ?? PhlebotomistScheduleStatus.ACTIVE,
    };
  }

  /** Merge an existing schedule with an update DTO into a resolved config. */
  private resolveConfigFromUpdate(
    existing: PhlebotomistScheduleDetail,
    dto: UpdatePhlebotomistScheduleDto,
  ): ResolvedConfig {
    return {
      startTime: dto.startTime ?? existing.startTime,
      endTime: dto.endTime ?? existing.endTime,
      intervalMinutes: dto.intervalMinutes ?? existing.intervalMinutes,
      travelBufferMinutes:
        dto.travelBufferMinutes ?? existing.travelBufferMinutes,
      maxVisitsPerDay: dto.maxVisitsPerDay ?? existing.maxVisitsPerDay,
      slotCapacity: dto.slotCapacity ?? existing.slotCapacity,
      recurrencePattern: dto.recurrencePattern ?? existing.recurrencePattern,
      selectedDays: dto.selectedDays ?? existing.days.map((d) => d.dayOfWeek),
      serviceType: dto.serviceType ?? existing.serviceType,
      status: dto.status ?? existing.status,
    };
  }

  /**
   * Enforce the schedule's business rules: end after start, a positive interval
   * that fits the window, non-negative travel buffer, positive max visits/day and
   * slot capacity, and days present for WEEKLY/CUSTOM recurrence.
   * @throws InvalidPhlebScheduleConfigException on the first violation
   */
  private validateConfig(config: ResolvedConfig): void {
    const start = toMinutes(config.startTime);
    const end = toMinutes(config.endTime);
    if (end <= start) {
      throw new InvalidPhlebScheduleConfigException(
        'endTime must be after startTime',
        { startTime: config.startTime, endTime: config.endTime },
      );
    }
    const windowLength = end - start;

    if (config.intervalMinutes <= 0) {
      throw new InvalidPhlebScheduleConfigException(
        'intervalMinutes must be greater than 0',
        { intervalMinutes: config.intervalMinutes },
      );
    }
    if (config.intervalMinutes > windowLength) {
      throw new InvalidPhlebScheduleConfigException(
        'intervalMinutes must fit within the working hours',
        { intervalMinutes: config.intervalMinutes, windowLength },
      );
    }
    if (config.travelBufferMinutes < 0) {
      throw new InvalidPhlebScheduleConfigException(
        'travelBufferMinutes cannot be negative',
        { travelBufferMinutes: config.travelBufferMinutes },
      );
    }
    if (config.maxVisitsPerDay <= 0) {
      throw new InvalidPhlebScheduleConfigException(
        'maxVisitsPerDay must be greater than 0',
        { maxVisitsPerDay: config.maxVisitsPerDay },
      );
    }
    if (config.slotCapacity <= 0) {
      throw new InvalidPhlebScheduleConfigException(
        'slotCapacity must be greater than 0',
        { slotCapacity: config.slotCapacity },
      );
    }
    if (
      config.recurrencePattern !== RecurrencePattern.DAILY &&
      config.selectedDays.length === 0
    ) {
      throw new InvalidPhlebScheduleConfigException(
        'selectedDays is required for WEEKLY/CUSTOM recurrence',
        { recurrencePattern: config.recurrencePattern },
      );
    }
  }

  /**
   * Reject a second ACTIVE schedule for the same phlebotomist + branch. Backs up
   * the partial unique index (rls.sql) with a friendly 409.
   * @throws PhlebotomistScheduleOverlapException
   */
  private async assertNoActiveSchedule(
    tenantId: string,
    phlebotomistId: string,
    branchId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await this.prisma.phlebotomistSchedule.findFirst({
      where: {
        tenantId,
        phlebotomistId,
        branchId,
        status: PhlebotomistScheduleStatus.ACTIVE,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (conflict) {
      throw new PhlebotomistScheduleOverlapException(
        phlebotomistId,
        branchId,
        conflict.id,
      );
    }
  }

  // ── Slot generation ───────────────────────────────────────────────────────

  /**
   * Regenerate future slots for a schedule. Retains future slots that already
   * contain a visit (booked), soft-deletes the rest, then creates fresh slots
   * across the horizon — skipping any retained date/time and honouring holidays,
   * overrides, weekly recurrence, the Sunday-off rule, and the max-visits/day cap.
   * Past slots are untouched.
   */
  private async regenerateFutureSlots(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    phlebotomistId: string,
    scheduleId: string,
    config: ResolvedConfig,
    holidays: ScheduleHolidayDto[],
    overrides: ScheduleOverrideDto[],
    horizonWeeks: number,
  ): Promise<void> {
    const today = startOfUtcDay(new Date());
    const horizonEnd = addDays(today, horizonWeeks * 7);

    // Retain future slots that contain a visit; soft-delete the unbooked rest.
    const existingFuture = await tx.phlebotomistSlot.findMany({
      where: {
        scheduleId,
        tenantId,
        deletedAt: null,
        slotDate: { gte: today },
      },
      select: { id: true, slotDate: true, startTime: true, endTime: true },
    });
    const visits = await this.directory.visitTimesInRange(
      tenantId,
      branchId ?? '',
      phlebotomistId,
      today,
      horizonEnd,
    );
    const occupied = this.bookedSlotKeys(existingFuture, visits);
    const unbookedIds = existingFuture
      .filter((s) => !occupied.has(`${formatDate(s.slotDate)}|${s.startTime}`))
      .map((s) => s.id);
    if (unbookedIds.length > 0) {
      await tx.phlebotomistSlot.updateMany({
        where: { id: { in: unbookedIds } },
        data: { deletedAt: new Date() },
      });
    }

    const holidaySet = new Set(
      holidays.map((h) => formatDate(toUtcDateOnly(h.date))),
    );
    const overrideMap = new Map(
      overrides.map((o) => [formatDate(toUtcDateOnly(o.date)), o]),
    );
    const daySet = new Set(config.selectedDays);
    const step = config.intervalMinutes + config.travelBufferMinutes;

    const rows: Prisma.PhlebotomistSlotCreateManyInput[] = [];
    for (let d = today; d < horizonEnd; d = addDays(d, 1)) {
      const dateStr = formatDate(d);
      if (holidaySet.has(dateStr)) continue;

      let windowStart: number;
      let windowEnd: number;
      const override = overrideMap.get(dateStr);
      if (override) {
        if (!override.startTime || !override.endTime) continue; // day off
        windowStart = toMinutes(override.startTime);
        windowEnd = toMinutes(override.endTime);
        if (windowEnd <= windowStart) continue;
      } else {
        // Sunday is off-duty unless an override supplies a window.
        if (isSunday(d)) continue;
        if (
          config.recurrencePattern !== RecurrencePattern.DAILY &&
          !daySet.has(dayOfWeekOf(d))
        ) {
          continue;
        }
        windowStart = toMinutes(config.startTime);
        windowEnd = toMinutes(config.endTime);
      }

      let generated = 0;
      for (
        let t = windowStart;
        t + config.intervalMinutes <= windowEnd &&
        generated < config.maxVisitsPerDay;
        t += step
      ) {
        const startStr = fromMinutes(t);
        if (occupied.has(`${dateStr}|${startStr}`)) {
          generated++;
          continue;
        }
        rows.push({
          tenantId,
          branchId,
          phlebotomistId,
          scheduleId,
          slotDate: d,
          startTime: startStr,
          endTime: fromMinutes(t + config.intervalMinutes),
          slotCapacity: config.slotCapacity,
          status: SlotStatus.AVAILABLE,
        });
        generated++;
      }
    }

    if (rows.length > 0) {
      await tx.phlebotomistSlot.createMany({ data: rows });
    }
  }

  /** Soft-delete a schedule's future, unbooked slots (from today forward). */
  private async softDeleteFutureUnbookedSlots(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    scheduleId: string,
    phlebotomistId: string,
  ): Promise<void> {
    const today = startOfUtcDay(new Date());
    const horizonEnd = addDays(today, DEFAULT_HORIZON_WEEKS * 7);
    const future = await tx.phlebotomistSlot.findMany({
      where: {
        scheduleId,
        tenantId,
        deletedAt: null,
        slotDate: { gte: today },
      },
      select: { id: true, slotDate: true, startTime: true, endTime: true },
    });
    const visits = await this.directory.visitTimesInRange(
      tenantId,
      branchId ?? '',
      phlebotomistId,
      today,
      horizonEnd,
    );
    const occupied = this.bookedSlotKeys(future, visits);
    const unbookedIds = future
      .filter((s) => !occupied.has(`${formatDate(s.slotDate)}|${s.startTime}`))
      .map((s) => s.id);
    if (unbookedIds.length > 0) {
      await tx.phlebotomistSlot.updateMany({
        where: { id: { in: unbookedIds } },
        data: { deletedAt: new Date() },
      });
    }
  }

  /**
   * Keys (`YYYY-MM-DD|HH:mm`) of slots whose window contains at least one visit.
   * A visit at time `v` books slot `[start, end)` on the same date when
   * `start <= minutes(v) < end`.
   */
  private bookedSlotKeys(
    slots: Array<{ slotDate: Date; startTime: string; endTime: string }>,
    visits: Date[],
  ): Set<string> {
    const minutesByDate = new Map<string, number[]>();
    for (const v of visits) {
      const key = formatDate(v);
      const list = minutesByDate.get(key) ?? [];
      list.push(utcMinutesOf(v));
      minutesByDate.set(key, list);
    }
    const booked = new Set<string>();
    for (const slot of slots) {
      const dateStr = formatDate(slot.slotDate);
      const mins = minutesByDate.get(dateStr);
      if (!mins) continue;
      const start = toMinutes(slot.startTime);
      const end = toMinutes(slot.endTime);
      if (mins.some((m) => m >= start && m < end)) {
        booked.add(`${dateStr}|${slot.startTime}`);
      }
    }
    return booked;
  }

  // ── Child-row builders ────────────────────────────────────────────────────

  /** Nested-create rows for a schedule's recurrence days. */
  private dayCreates(
    tenantId: string,
    config: ResolvedConfig,
  ): Prisma.PhlebotomistScheduleDayCreateWithoutScheduleInput[] {
    const days =
      config.recurrencePattern === RecurrencePattern.DAILY
        ? []
        : config.selectedDays;
    return days.map((dayOfWeek) => ({ tenantId, dayOfWeek }));
  }

  /** Nested-create rows for a schedule's service zones. */
  private zoneCreates(
    tenantId: string,
    zoneIds: string[],
  ): Prisma.PhlebotomistScheduleZoneCreateWithoutScheduleInput[] {
    return zoneIds.map((zoneId) => ({
      tenantId,
      zone: { connect: { id: zoneId } },
    }));
  }

  /** Nested-create rows for a schedule's holidays. */
  private holidayCreates(
    tenantId: string,
    holidays: ScheduleHolidayDto[] | undefined,
  ): Prisma.PhlebotomistScheduleHolidayCreateWithoutScheduleInput[] {
    return (holidays ?? []).map((h) => ({
      tenantId,
      holidayDate: toUtcDateOnly(h.date),
      remarks: h.remarks ?? null,
    }));
  }

  /** Nested-create rows for a schedule's overrides. */
  private overrideCreates(
    tenantId: string,
    overrides: ScheduleOverrideDto[] | undefined,
  ): Prisma.PhlebotomistScheduleOverrideCreateWithoutScheduleInput[] {
    return (overrides ?? []).map((o) => ({
      tenantId,
      overrideDate: toUtcDateOnly(o.date),
      startTime: o.startTime ?? null,
      endTime: o.endTime ?? null,
    }));
  }
}
