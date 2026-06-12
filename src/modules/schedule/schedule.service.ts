import { Injectable } from '@nestjs/common';
import { Prisma, Schedule, ScheduleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { BranchService } from '../branch/branch.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ShiftDto } from './dto/shift.dto';
import {
  InvalidScheduleDatesException,
  InvalidShiftException,
  ScheduleNotFoundException,
  ScheduleOverlapException,
} from './exceptions/schedule.exceptions';

/** Minutes in a day, used for midnight-aware shift maths. */
const MINUTES_PER_DAY = 24 * 60;

/**
 * Schedule management. Tenant-scoped **and** branch-level: every query carries
 * `tenantId` + `branchId` and filters soft-deleted rows (CLAUDE.md §4.7).
 *
 * Shifts are stored as JSON on the schedule itself, each carrying its own
 * `activeDays`. Shift times are 24h `HH:mm`, branch-local; a NIGHT shift may
 * cross midnight (`endTime` <= `startTime`) and all time maths here is
 * midnight-aware.
 */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Create a schedule for a branch.
   * @param tenantId tenant scope (from JWT)
   * @param branchId owning branch (from route; validated against the tenant)
   * @param dto validated schedule payload
   * @param actorId person id of the creator (optional audit trail)
   * @returns the created schedule
   * @throws BranchNotFoundException if the branch is missing/other tenant
   * @throws InvalidShiftException / InvalidScheduleDatesException on bad input
   * @throws ScheduleOverlapException if an ACTIVE schedule already covers the dates
   */
  async create(
    tenantId: string,
    branchId: string,
    dto: CreateScheduleDto,
    actorId?: string,
  ): Promise<Schedule> {
    // Validates the branch belongs to the caller's tenant (throws otherwise).
    await this.branchService.findById(branchId, tenantId);

    this.validateShifts(dto.shifts);
    const effectiveFrom = new Date(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    this.assertValidDateRange(effectiveFrom, effectiveTo);

    const status = dto.status ?? ScheduleStatus.DRAFT;
    if (status === ScheduleStatus.ACTIVE) {
      await this.assertNoActiveDateOverlap(
        tenantId,
        branchId,
        effectiveFrom,
        effectiveTo,
      );
    }

    return this.prisma.schedule.create({
      data: {
        tenantId,
        branchId,
        planName: dto.planName,
        status,
        effectiveFrom,
        effectiveTo,
        shifts: dto.shifts as unknown as Prisma.InputJsonValue,
        createdBy: actorId ?? null,
        updatedBy: actorId ?? null,
      },
    });
  }

  /**
   * Fetch one active schedule scoped to its branch + tenant.
   * @param id schedule id
   * @param tenantId tenant scope
   * @param branchId owning branch
   * @throws ScheduleNotFoundException if missing or soft-deleted
   */
  async findById(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<Schedule> {
    const schedule = await this.prisma.schedule.findFirst({
      where: { id, tenantId, branchId, deletedAt: null },
    });
    if (!schedule) {
      throw new ScheduleNotFoundException(id);
    }
    return schedule;
  }

  /**
   * List active schedules for a branch (offset pagination).
   * @param tenantId tenant scope
   * @param branchId owning branch
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   */
  async findAllForBranch(
    tenantId: string,
    branchId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<Schedule>> {
    const where = { tenantId, branchId, deletedAt: null };
    // Sequential (not array-`$transaction`) so each call flows through the RLS
    // extension and carries the tenant GUC when RLS is enabled.
    const data = await this.prisma.schedule.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { effectiveFrom: 'desc' },
    });
    const total = await this.prisma.schedule.count({ where });
    return { data, total, page, limit };
  }

  /**
   * Update a schedule. Re-validates shifts (if changed) and re-checks date
   * overlap whenever the result would be an ACTIVE schedule.
   * @param id schedule id
   * @param tenantId tenant scope
   * @param branchId owning branch
   * @param dto partial update
   * @param actorId person id of the editor (optional audit trail)
   * @throws ScheduleNotFoundException / InvalidShiftException /
   *   InvalidScheduleDatesException / ScheduleOverlapException
   */
  async update(
    id: string,
    tenantId: string,
    branchId: string,
    dto: UpdateScheduleDto,
    actorId?: string,
  ): Promise<Schedule> {
    const existing = await this.findById(id, tenantId, branchId);

    if (dto.shifts !== undefined) {
      this.validateShifts(dto.shifts);
    }

    const effectiveFrom =
      dto.effectiveFrom !== undefined
        ? new Date(dto.effectiveFrom)
        : existing.effectiveFrom;
    const effectiveTo =
      dto.effectiveTo !== undefined
        ? dto.effectiveTo
          ? new Date(dto.effectiveTo)
          : null
        : existing.effectiveTo;
    this.assertValidDateRange(effectiveFrom, effectiveTo);

    const status = dto.status ?? existing.status;
    if (status === ScheduleStatus.ACTIVE) {
      await this.assertNoActiveDateOverlap(
        tenantId,
        branchId,
        effectiveFrom,
        effectiveTo,
        id,
      );
    }

    const data: Prisma.ScheduleUpdateInput = {};
    if (dto.planName !== undefined) data.planName = dto.planName;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.effectiveFrom !== undefined) data.effectiveFrom = effectiveFrom;
    if (dto.effectiveTo !== undefined) data.effectiveTo = effectiveTo;
    if (dto.shifts !== undefined) {
      data.shifts = dto.shifts as unknown as Prisma.InputJsonValue;
    }
    // Only stamp the actor when one was supplied — never clobber an existing
    // updatedBy with null on actor-less internal calls.
    if (actorId !== undefined) {
      data.updatedBy = actorId;
    }

    return this.prisma.schedule.update({ where: { id }, data });
  }

  /**
   * Soft-delete a schedule (sets deletedAt; row is preserved).
   * @param id schedule id
   * @param tenantId tenant scope
   * @param branchId owning branch
   */
  async remove(
    id: string,
    tenantId: string,
    branchId: string,
  ): Promise<Schedule> {
    await this.findById(id, tenantId, branchId);
    return this.prisma.schedule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Validation helpers ──────────────────────────────────────────────────────

  /**
   * Validate a schedule's shift set: each shift's break must fall inside its
   * working window, and no two shifts may overlap in time *on a day they both
   * run* (two shifts at the same clock time on disjoint days are allowed). All
   * time checks are midnight-aware (a shift/break may wrap past 00:00).
   * @param shifts the shifts to validate
   * @throws InvalidShiftException on any violation
   */
  private validateShifts(shifts: ShiftDto[]): void {
    for (const shift of shifts) {
      const start = this.toMinutes(shift.startTime);
      const end = this.toMinutes(shift.endTime);
      if (start === end) {
        throw new InvalidShiftException(
          'A shift must not start and end at the same time',
          { shiftName: shift.shiftName },
        );
      }
      const shiftLength = this.durationFrom(start, end); // 1..1439

      // Break must lie fully within the shift window (wrap-aware).
      const breakStart = this.toMinutes(shift.breakStartTime);
      const breakEnd = this.toMinutes(shift.breakEndTime);
      if (breakStart === breakEnd) {
        throw new InvalidShiftException(
          'A break must not start and end at the same time',
          { shiftName: shift.shiftName },
        );
      }
      const breakOffset = this.offsetFrom(start, breakStart); // 0..1439
      const breakLength = this.durationFrom(breakStart, breakEnd);
      if (breakOffset + breakLength > shiftLength) {
        throw new InvalidShiftException(
          'A break must fall entirely within its shift',
          {
            shiftName: shift.shiftName,
            startTime: shift.startTime,
            endTime: shift.endTime,
            breakStartTime: shift.breakStartTime,
            breakEndTime: shift.breakEndTime,
          },
        );
      }
    }

    // No two shifts may overlap in clock time on a day they both run (compare
    // expanded intervals; shifts on disjoint days never conflict).
    for (let i = 0; i < shifts.length; i++) {
      const a = shifts[i];
      for (let j = i + 1; j < shifts.length; j++) {
        const b = shifts[j];
        if (a && b && this.shiftsShareDay(a, b) && this.shiftsOverlap(a, b)) {
          throw new InvalidShiftException(
            'Two shifts overlap in time on a shared active day',
            {
              a: a.shiftName,
              b: b.shiftName,
            },
          );
        }
      }
    }
  }

  /** True if two shifts share at least one active day of the week. */
  private shiftsShareDay(a: ShiftDto, b: ShiftDto): boolean {
    const bDays = new Set(b.activeDays);
    return a.activeDays.some((day) => bDays.has(day));
  }

  /**
   * Reject creating/activating a second ACTIVE schedule whose effective-date
   * range overlaps an existing one for the same branch. Null `effectiveTo`
   * means open-ended (+∞).
   * @param tenantId tenant scope
   * @param branchId owning branch
   * @param from new schedule's effectiveFrom
   * @param to new schedule's effectiveTo (null = open-ended)
   * @param excludeId schedule id to ignore (the one being updated)
   * @throws ScheduleOverlapException on the first overlapping active schedule
   */
  private async assertNoActiveDateOverlap(
    tenantId: string,
    branchId: string,
    from: Date,
    to: Date | null,
    excludeId?: string,
  ): Promise<void> {
    const actives = await this.prisma.schedule.findMany({
      where: {
        tenantId,
        branchId,
        status: ScheduleStatus.ACTIVE,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });
    for (const s of actives) {
      if (this.dateRangesOverlap(from, to, s.effectiveFrom, s.effectiveTo)) {
        throw new ScheduleOverlapException(branchId, s.id);
      }
    }
  }

  /**
   * Reject an effective-date range whose end falls before its start. A null
   * end (open-ended) is always valid.
   * @throws InvalidScheduleDatesException
   */
  private assertValidDateRange(from: Date, to: Date | null): void {
    if (to && to < from) {
      throw new InvalidScheduleDatesException(
        from.toISOString(),
        to.toISOString(),
      );
    }
  }

  /**
   * Two inclusive date ranges overlap; a null end means open-ended (+∞).
   */
  private dateRangesOverlap(
    aFrom: Date,
    aTo: Date | null,
    bFrom: Date,
    bTo: Date | null,
  ): boolean {
    const aStartsBeforeBEnds = bTo === null || aFrom <= bTo;
    const bStartsBeforeAEnds = aTo === null || bFrom <= aTo;
    return aStartsBeforeBEnds && bStartsBeforeAEnds;
  }

  /** True if two shifts' (possibly midnight-wrapping) windows intersect. */
  private shiftsOverlap(a: ShiftDto, b: ShiftDto): boolean {
    const aIntervals = this.shiftIntervals(a);
    const bIntervals = this.shiftIntervals(b);
    for (const [aStart, aEnd] of aIntervals) {
      for (const [bStart, bEnd] of bIntervals) {
        if (aStart < bEnd && bStart < aEnd) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Expand a shift into 1–2 non-wrapping `[start, end)` minute intervals. A
   * shift that crosses midnight (end <= start) becomes `[start, 1440)` and
   * `[0, end)`.
   */
  private shiftIntervals(shift: ShiftDto): Array<[number, number]> {
    const start = this.toMinutes(shift.startTime);
    const end = this.toMinutes(shift.endTime);
    if (end > start) {
      return [[start, end]];
    }
    return [
      [start, MINUTES_PER_DAY],
      [0, end],
    ];
  }

  /** Convert an `HH:mm` string to minutes since midnight (0..1439). */
  private toMinutes(hhmm: string): number {
    const [h = 0, m = 0] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  /** Forward duration from `start` to `end` in minutes, wrapping midnight (1..1440). */
  private durationFrom(start: number, end: number): number {
    return ((end - start + MINUTES_PER_DAY - 1) % MINUTES_PER_DAY) + 1;
  }

  /** Forward offset of `point` from `start` in minutes, wrapping midnight (0..1439). */
  private offsetFrom(start: number, point: number): number {
    return (point - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  }
}
