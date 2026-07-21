import { Injectable } from '@nestjs/common';
import {
  DayOfWeek,
  DoctorScheduleStatus,
  Prisma,
  RecurrencePattern,
  SlotStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { DoctorsService } from '../doctors/doctors.service';
import { CreateDoctorScheduleDto } from './dto/create-doctor-schedule.dto';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto';
import { ScheduleHolidayDto } from './dto/schedule-holiday.dto';
import { ScheduleOverrideDto } from './dto/schedule-override.dto';
import {
  DOCTOR_SCHEDULE_DETAIL_INCLUDE,
  DoctorScheduleDetail,
} from './entities/doctor-schedule.entity';
import {
  DoctorScheduleForDoctorNotFoundException,
  DoctorScheduleNotFoundException,
  DoctorScheduleOverlapException,
  InvalidScheduleConfigException,
  ScheduleHasBookingsException,
} from './exceptions/doctor-schedule.exceptions';
import {
  addDays,
  dayOfWeekOf,
  formatDate,
  fromMinutes,
  startOfUtcDay,
  toMinutes,
  toUtcDateOnly,
} from './utils/schedule-time.util';

/** Default number of weeks ahead to generate slots for. */
const DEFAULT_HORIZON_WEEKS = 8;

/** A schedule's timing/recurrence resolved into the shape slot generation uses. */
interface ResolvedConfig {
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
  durationMinutes: number;
  slotIntervalMinutes: number;
  maxPatientsPerSlot: number;
  bufferMinutes: number;
  recurrencePattern: RecurrencePattern;
  selectedDays: DayOfWeek[];
  status: DoctorScheduleStatus;
}

/**
 * Doctor schedule configuration + slot generation. Tenant-scoped **and**
 * branch-level (CLAUDE.md §4.5–4.7): every query carries `tenantId`
 * (defence-in-depth on top of RLS) and filters soft-deleted rows. The `doctorId`
 * and `branchId` are validated against the caller's tenant via the injected
 * `DoctorsService`/`BranchService` (rule #3 — never import a service file
 * directly, never trust an id from the body).
 *
 * Working-window times are 24h `HH:mm` branch-local strings. A schedule
 * generates concrete `DoctorSlot` rows for a rolling horizon; regeneration only
 * ever touches **future, unbooked** slots — booked and past slots are never
 * modified or removed automatically (business rules §4).
 */
@Injectable()
export class DoctorScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly doctorsService: DoctorsService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Create a doctor schedule and generate its future slots (when ACTIVE), all in
   * one transaction. Validates the doctor and branch belong to the caller's
   * tenant, checks the config, and enforces the one-active-schedule-per-
   * doctor+branch rule.
   * @param tenantId tenant scope (from the JWT)
   * @param dto validated schedule payload
   * @param actorId person id of the creator (audit trail)
   * @returns the created schedule with its days/holidays/overrides
   * @throws DoctorNotFoundException / BranchNotFoundException on bad ids
   * @throws InvalidScheduleConfigException on a bad config
   * @throws DoctorScheduleOverlapException if an active schedule already exists
   */
  async create(
    tenantId: string,
    dto: CreateDoctorScheduleDto,
    actorId?: string,
  ): Promise<DoctorScheduleDetail> {
    await this.doctorsService.findById(dto.doctorId, tenantId);
    await this.branchService.findById(dto.branchId, tenantId);

    const config = this.resolveConfigFromCreate(dto);
    this.validateConfig(config);

    const status = dto.status ?? DoctorScheduleStatus.ACTIVE;
    if (status === DoctorScheduleStatus.ACTIVE) {
      await this.assertNoActiveSchedule(tenantId, dto.doctorId, dto.branchId);
    }

    return this.prisma.withTenant(tenantId, async (tx) => {
      const schedule = await tx.doctorSchedule.create({
        data: {
          tenantId,
          branchId: dto.branchId,
          doctorId: dto.doctorId,
          consultationMode: dto.consultationMode,
          slotType: dto.slotType,
          status,
          startTime: dto.startTime,
          endTime: dto.endTime,
          breakStart: dto.breakStart ?? null,
          breakEnd: dto.breakEnd ?? null,
          durationMinutes: dto.durationMinutes,
          slotIntervalMinutes: dto.slotIntervalMinutes,
          maxPatientsPerSlot: dto.maxPatientsPerSlot,
          bufferMinutes: dto.bufferMinutes ?? 0,
          recurrencePattern: dto.recurrencePattern,
          createdBy: actorId ?? null,
          updatedBy: actorId ?? null,
          days: {
            create: this.dayCreates(tenantId, config),
          },
          holidays: {
            create: this.holidayCreates(tenantId, dto.holidays),
          },
          overrides: {
            create: this.overrideCreates(tenantId, dto.overrides),
          },
        },
        include: DOCTOR_SCHEDULE_DETAIL_INCLUDE,
      });

      if (status === DoctorScheduleStatus.ACTIVE) {
        await this.regenerateFutureSlots(
          tx,
          tenantId,
          dto.branchId,
          dto.doctorId,
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
   * Fetch a doctor's single ACTIVE schedule with its children (used to hydrate
   * the Configure form). Falls back to the most recent non-deleted schedule when
   * none is ACTIVE.
   * @param tenantId tenant scope
   * @param doctorId the doctor
   * @throws DoctorScheduleForDoctorNotFoundException if none exists
   */
  async findByDoctor(
    tenantId: string,
    doctorId: string,
  ): Promise<DoctorScheduleDetail> {
    const active = await this.prisma.doctorSchedule.findFirst({
      where: {
        tenantId,
        doctorId,
        status: DoctorScheduleStatus.ACTIVE,
        deletedAt: null,
      },
      include: DOCTOR_SCHEDULE_DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    if (active) return active;

    const latest = await this.prisma.doctorSchedule.findFirst({
      where: { tenantId, doctorId, deletedAt: null },
      include: DOCTOR_SCHEDULE_DETAIL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) {
      throw new DoctorScheduleForDoctorNotFoundException(doctorId);
    }
    return latest;
  }

  /**
   * Fetch one schedule by id, scoped to the tenant, with its children.
   * @param id schedule id
   * @param tenantId tenant scope
   * @throws DoctorScheduleNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string): Promise<DoctorScheduleDetail> {
    const schedule = await this.prisma.doctorSchedule.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: DOCTOR_SCHEDULE_DETAIL_INCLUDE,
    });
    if (!schedule) {
      throw new DoctorScheduleNotFoundException(id);
    }
    return schedule;
  }

  /**
   * Update a schedule. Only supplied fields change; `doctorId`/`branchId` are
   * immutable. Children (`days`/`holidays`/`overrides`) are replaced when
   * supplied. When the effective config or status changes, **future unbooked**
   * slots are regenerated (past and booked slots are never touched). All in one
   * transaction.
   * @param id schedule id
   * @param tenantId tenant scope
   * @param dto partial update
   * @param actorId person id of the editor (audit trail)
   * @throws DoctorScheduleNotFoundException / InvalidScheduleConfigException /
   *   DoctorScheduleOverlapException
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateDoctorScheduleDto,
    actorId?: string,
  ): Promise<DoctorScheduleDetail> {
    const existing = await this.findById(id, tenantId);

    const config = this.resolveConfigFromUpdate(existing, dto);
    this.validateConfig(config);

    const status = dto.status ?? existing.status;
    if (status === DoctorScheduleStatus.ACTIVE) {
      await this.assertNoActiveSchedule(
        tenantId,
        existing.doctorId,
        existing.branchId,
        id,
      );
    }

    // Effective holidays/overrides for regeneration: the supplied set when
    // provided, otherwise the schedule's existing rows.
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
      const data: Prisma.DoctorScheduleUpdateInput = {};
      if (dto.consultationMode !== undefined) {
        data.consultationMode = dto.consultationMode;
      }
      if (dto.slotType !== undefined) data.slotType = dto.slotType;
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.startTime !== undefined) data.startTime = dto.startTime;
      if (dto.endTime !== undefined) data.endTime = dto.endTime;
      if (dto.breakStart !== undefined)
        data.breakStart = dto.breakStart ?? null;
      if (dto.breakEnd !== undefined) data.breakEnd = dto.breakEnd ?? null;
      if (dto.durationMinutes !== undefined) {
        data.durationMinutes = dto.durationMinutes;
      }
      if (dto.slotIntervalMinutes !== undefined) {
        data.slotIntervalMinutes = dto.slotIntervalMinutes;
      }
      if (dto.maxPatientsPerSlot !== undefined) {
        data.maxPatientsPerSlot = dto.maxPatientsPerSlot;
      }
      if (dto.bufferMinutes !== undefined) {
        data.bufferMinutes = dto.bufferMinutes;
      }
      if (dto.recurrencePattern !== undefined) {
        data.recurrencePattern = dto.recurrencePattern;
      }
      if (actorId !== undefined) data.updatedBy = actorId;

      // Regenerated child config is replaced wholesale. The new rows reuse the
      // same unique keys (e.g. (scheduleId, dayOfWeek)), so the previous rows
      // must be hard-deleted — soft-deleting would leave the unique key occupied
      // and the re-create would collide. Reads already filter deletedAt: null,
      // so nothing depended on retaining these rows.
      if (
        dto.selectedDays !== undefined ||
        dto.recurrencePattern !== undefined
      ) {
        await tx.doctorScheduleDay.deleteMany({
          where: { scheduleId: id, tenantId },
        });
        data.days = { create: this.dayCreates(tenantId, config) };
      }
      if (dto.holidays !== undefined) {
        await tx.doctorScheduleHoliday.deleteMany({
          where: { scheduleId: id, tenantId },
        });
        data.holidays = { create: this.holidayCreates(tenantId, dto.holidays) };
      }
      if (dto.overrides !== undefined) {
        await tx.doctorScheduleOverride.deleteMany({
          where: { scheduleId: id, tenantId },
        });
        data.overrides = {
          create: this.overrideCreates(tenantId, dto.overrides),
        };
      }

      const schedule = await tx.doctorSchedule.update({
        where: { id },
        data,
        include: DOCTOR_SCHEDULE_DETAIL_INCLUDE,
      });

      if (status === DoctorScheduleStatus.ACTIVE) {
        await this.regenerateFutureSlots(
          tx,
          tenantId,
          existing.branchId,
          existing.doctorId,
          id,
          config,
          holidays,
          overrides,
          dto.horizonWeeks ?? DEFAULT_HORIZON_WEEKS,
        );
      } else {
        // No longer active — retire future unbooked slots.
        await this.softDeleteFutureUnbookedSlots(tx, tenantId, id);
      }

      return schedule;
    });
  }

  /**
   * Soft-delete a schedule. Only allowed when it has no **future booked** slots
   * (booked appointments are never removed automatically). Its future unbooked
   * slots and child rows are soft-deleted alongside it.
   * @param id schedule id
   * @param tenantId tenant scope
   * @throws DoctorScheduleNotFoundException if missing
   * @throws ScheduleHasBookingsException if future booked slots exist
   */
  async remove(id: string, tenantId: string): Promise<DoctorScheduleDetail> {
    const schedule = await this.findById(id, tenantId);
    const today = startOfUtcDay(new Date());

    const futureBooked = await this.prisma.doctorSlot.count({
      where: {
        scheduleId: id,
        tenantId,
        deletedAt: null,
        slotDate: { gte: today },
        bookedPatients: { gt: 0 },
      },
    });
    if (futureBooked > 0) {
      throw new ScheduleHasBookingsException(id, futureBooked);
    }

    await this.prisma.withTenant(tenantId, async (tx) => {
      const now = new Date();
      await this.softDeleteFutureUnbookedSlots(tx, tenantId, id);
      await tx.doctorScheduleDay.updateMany({
        where: { scheduleId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.doctorScheduleHoliday.updateMany({
        where: { scheduleId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.doctorScheduleOverride.updateMany({
        where: { scheduleId: id, tenantId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.doctorSchedule.update({
        where: { id },
        data: { deletedAt: now },
      });
    });

    return schedule;
  }

  // ── Config resolution & validation ────────────────────────────────────────

  /** Build the resolved config from a create DTO. */
  private resolveConfigFromCreate(
    dto: CreateDoctorScheduleDto,
  ): ResolvedConfig {
    return {
      startTime: dto.startTime,
      endTime: dto.endTime,
      breakStart: dto.breakStart ?? null,
      breakEnd: dto.breakEnd ?? null,
      durationMinutes: dto.durationMinutes,
      slotIntervalMinutes: dto.slotIntervalMinutes,
      maxPatientsPerSlot: dto.maxPatientsPerSlot,
      bufferMinutes: dto.bufferMinutes ?? 0,
      recurrencePattern: dto.recurrencePattern,
      selectedDays: dto.selectedDays ?? [],
      status: dto.status ?? DoctorScheduleStatus.ACTIVE,
    };
  }

  /** Merge an existing schedule with an update DTO into a resolved config. */
  private resolveConfigFromUpdate(
    existing: DoctorScheduleDetail,
    dto: UpdateDoctorScheduleDto,
  ): ResolvedConfig {
    return {
      startTime: dto.startTime ?? existing.startTime,
      endTime: dto.endTime ?? existing.endTime,
      breakStart:
        dto.breakStart !== undefined
          ? (dto.breakStart ?? null)
          : existing.breakStart,
      breakEnd:
        dto.breakEnd !== undefined ? (dto.breakEnd ?? null) : existing.breakEnd,
      durationMinutes: dto.durationMinutes ?? existing.durationMinutes,
      slotIntervalMinutes:
        dto.slotIntervalMinutes ?? existing.slotIntervalMinutes,
      maxPatientsPerSlot: dto.maxPatientsPerSlot ?? existing.maxPatientsPerSlot,
      bufferMinutes: dto.bufferMinutes ?? existing.bufferMinutes,
      recurrencePattern: dto.recurrencePattern ?? existing.recurrencePattern,
      selectedDays: dto.selectedDays ?? existing.days.map((d) => d.dayOfWeek),
      status: dto.status ?? existing.status,
    };
  }

  /**
   * Enforce the schedule's business rules (CLAUDE.md-referenced §7 of the plan):
   * end after start, break inside the window, positive duration that fits the
   * window, interval ≥ duration, non-negative buffer, and days present for
   * WEEKLY/CUSTOM recurrence.
   * @throws InvalidScheduleConfigException on the first violation
   */
  private validateConfig(config: ResolvedConfig): void {
    const start = toMinutes(config.startTime);
    const end = toMinutes(config.endTime);
    if (end <= start) {
      throw new InvalidScheduleConfigException(
        'endTime must be after startTime',
        { startTime: config.startTime, endTime: config.endTime },
      );
    }
    const windowLength = end - start;

    if (config.breakStart || config.breakEnd) {
      if (!config.breakStart || !config.breakEnd) {
        throw new InvalidScheduleConfigException(
          'breakStart and breakEnd must both be set',
          { breakStart: config.breakStart, breakEnd: config.breakEnd },
        );
      }
      const bStart = toMinutes(config.breakStart);
      const bEnd = toMinutes(config.breakEnd);
      if (bEnd <= bStart) {
        throw new InvalidScheduleConfigException(
          'breakEnd must be after breakStart',
          { breakStart: config.breakStart, breakEnd: config.breakEnd },
        );
      }
      if (bStart < start || bEnd > end) {
        throw new InvalidScheduleConfigException(
          'The break must fall within the working hours',
          {
            startTime: config.startTime,
            endTime: config.endTime,
            breakStart: config.breakStart,
            breakEnd: config.breakEnd,
          },
        );
      }
    }

    if (config.durationMinutes <= 0) {
      throw new InvalidScheduleConfigException(
        'durationMinutes must be greater than 0',
        { durationMinutes: config.durationMinutes },
      );
    }
    if (config.durationMinutes > windowLength) {
      throw new InvalidScheduleConfigException(
        'durationMinutes must fit within the working hours',
        { durationMinutes: config.durationMinutes, windowLength },
      );
    }
    if (config.slotIntervalMinutes < config.durationMinutes) {
      throw new InvalidScheduleConfigException(
        'slotIntervalMinutes must be greater than or equal to durationMinutes',
        {
          slotIntervalMinutes: config.slotIntervalMinutes,
          durationMinutes: config.durationMinutes,
        },
      );
    }
    if (config.bufferMinutes < 0) {
      throw new InvalidScheduleConfigException(
        'bufferMinutes cannot be negative',
        { bufferMinutes: config.bufferMinutes },
      );
    }
    if (
      config.recurrencePattern !== RecurrencePattern.DAILY &&
      config.selectedDays.length === 0
    ) {
      throw new InvalidScheduleConfigException(
        'selectedDays is required for WEEKLY/CUSTOM recurrence',
        { recurrencePattern: config.recurrencePattern },
      );
    }
  }

  /**
   * Reject a second ACTIVE schedule for the same doctor + branch. Backs up the
   * partial unique index (rls.sql) with a friendly 409.
   * @throws DoctorScheduleOverlapException
   */
  private async assertNoActiveSchedule(
    tenantId: string,
    doctorId: string,
    branchId: string | null,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await this.prisma.doctorSchedule.findFirst({
      where: {
        tenantId,
        doctorId,
        branchId,
        status: DoctorScheduleStatus.ACTIVE,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (conflict) {
      throw new DoctorScheduleOverlapException(doctorId, branchId, conflict.id);
    }
  }

  // ── Slot generation ───────────────────────────────────────────────────────

  /**
   * Regenerate future slots for a schedule. Soft-deletes existing **future
   * unbooked** slots, then creates fresh slots across the horizon — skipping any
   * date/time that still has an active (booked) slot, so booked slots are never
   * duplicated or disturbed. Past slots are untouched.
   */
  private async regenerateFutureSlots(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    doctorId: string,
    scheduleId: string,
    config: ResolvedConfig,
    holidays: ScheduleHolidayDto[],
    overrides: ScheduleOverrideDto[],
    horizonWeeks: number,
  ): Promise<void> {
    await this.softDeleteFutureUnbookedSlots(tx, tenantId, scheduleId);

    // Retained (booked) future slots: skip these date/time keys when generating.
    const today = startOfUtcDay(new Date());
    const retained = await tx.doctorSlot.findMany({
      where: {
        scheduleId,
        tenantId,
        deletedAt: null,
        slotDate: { gte: today },
      },
      select: { slotDate: true, startTime: true },
    });
    const occupied = new Set(
      retained.map((s) => `${formatDate(s.slotDate)}|${s.startTime}`),
    );

    const holidaySet = new Set(
      holidays.map((h) => formatDate(toUtcDateOnly(h.date))),
    );
    const overrideMap = new Map(
      overrides.map((o) => [formatDate(toUtcDateOnly(o.date)), o]),
    );
    const daySet = new Set(config.selectedDays);

    const rows: Prisma.DoctorSlotCreateManyInput[] = [];
    const horizonEnd = addDays(today, horizonWeeks * 7);
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
        if (
          config.recurrencePattern !== RecurrencePattern.DAILY &&
          !daySet.has(dayOfWeekOf(d))
        ) {
          continue;
        }
        windowStart = toMinutes(config.startTime);
        windowEnd = toMinutes(config.endTime);
      }

      const breakStart = config.breakStart
        ? toMinutes(config.breakStart)
        : null;
      const breakEnd = config.breakEnd ? toMinutes(config.breakEnd) : null;
      const step = config.slotIntervalMinutes + config.bufferMinutes;

      for (
        let t = windowStart;
        t + config.durationMinutes <= windowEnd;
        t += step
      ) {
        const slotEnd = t + config.durationMinutes;
        // Skip any slot that overlaps the break window.
        if (
          breakStart !== null &&
          breakEnd !== null &&
          t < breakEnd &&
          breakStart < slotEnd
        ) {
          continue;
        }
        const startStr = fromMinutes(t);
        if (occupied.has(`${dateStr}|${startStr}`)) continue;

        rows.push({
          tenantId,
          branchId,
          doctorId,
          scheduleId,
          slotDate: d,
          startTime: startStr,
          endTime: fromMinutes(slotEnd),
          maxPatients: config.maxPatientsPerSlot,
          bookedPatients: 0,
          status: SlotStatus.AVAILABLE,
        });
      }
    }

    if (rows.length > 0) {
      await tx.doctorSlot.createMany({ data: rows });
    }
  }

  /** Soft-delete a schedule's future, unbooked slots (from today forward). */
  private async softDeleteFutureUnbookedSlots(
    tx: Prisma.TransactionClient,
    tenantId: string,
    scheduleId: string,
  ): Promise<void> {
    const today = startOfUtcDay(new Date());
    await tx.doctorSlot.updateMany({
      where: {
        scheduleId,
        tenantId,
        deletedAt: null,
        slotDate: { gte: today },
        bookedPatients: 0,
      },
      data: { deletedAt: new Date() },
    });
  }

  // ── Child-row builders ────────────────────────────────────────────────────

  /** Nested-create rows for a schedule's recurrence days. */
  private dayCreates(
    tenantId: string,
    config: ResolvedConfig,
  ): Prisma.DoctorScheduleDayCreateWithoutScheduleInput[] {
    const days =
      config.recurrencePattern === RecurrencePattern.DAILY
        ? []
        : config.selectedDays;
    return days.map((dayOfWeek) => ({ tenantId, dayOfWeek }));
  }

  /** Nested-create rows for a schedule's holidays. */
  private holidayCreates(
    tenantId: string,
    holidays: ScheduleHolidayDto[] | undefined,
  ): Prisma.DoctorScheduleHolidayCreateWithoutScheduleInput[] {
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
  ): Prisma.DoctorScheduleOverrideCreateWithoutScheduleInput[] {
    return (overrides ?? []).map((o) => ({
      tenantId,
      overrideDate: toUtcDateOnly(o.date),
      startTime: o.startTime ?? null,
      endTime: o.endTime ?? null,
    }));
  }
}
