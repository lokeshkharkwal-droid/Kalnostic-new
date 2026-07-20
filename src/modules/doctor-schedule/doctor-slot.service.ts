import { Injectable } from '@nestjs/common';
import { DoctorSlot, Prisma, SlotStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DoctorsService } from '../doctors/doctors.service';
import {
  CalendarDay,
  CalendarResponse,
  CalendarSlot,
  SlotDisplayStatus,
  TodaySlot,
} from './entities/doctor-schedule.entity';
import {
  SlotFullException,
  SlotInPastException,
  SlotNotBookedException,
  SlotNotFoundException,
} from './exceptions/doctor-schedule.exceptions';
import {
  addDays,
  dayNameOf,
  formatDate,
  startOfUtcDay,
  toMinutes,
  toUtcDateOnly,
} from './utils/schedule-time.util';

/** Milliseconds in a (Julian) year, for experience-span maths. */
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Read + booking operations over generated `DoctorSlot`s: the weekly calendar,
 * today's slots, and the reserve/release counter. Tenant-scoped + branch-level
 * (CLAUDE.md §4.7): every query carries `tenantId` and filters soft-deleted rows.
 *
 * Slot display state is **derived at read time** — `Past` (elapsed),
 * `Unavailable` (no slots that day) — on top of the stored coarse
 * AVAILABLE/BOOKED/FULL counter state, so the frontend needs no extra logic for
 * previous/next week.
 */
@Injectable()
export class DoctorSlotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly doctorsService: DoctorsService,
  ) {}

  /**
   * Build the 7-day calendar for a doctor starting at `weekStart`, with the
   * doctor header and each day's slots. Previous/next week is served by passing a
   * different `weekStart` — no frontend business logic required.
   * @param tenantId tenant scope
   * @param doctorId the doctor
   * @param weekStart ISO `YYYY-MM-DD`; the first day of the week to render
   * @throws DoctorNotFoundException if the doctor isn't in the tenant
   */
  async getCalendar(
    tenantId: string,
    doctorId: string,
    weekStart: string,
  ): Promise<CalendarResponse> {
    const doctor = await this.doctorsService.findById(doctorId, tenantId);

    const start = toUtcDateOnly(weekStart);
    const end = addDays(start, 7);
    const slots = await this.prisma.doctorSlot.findMany({
      where: {
        tenantId,
        doctorId,
        deletedAt: null,
        slotDate: { gte: start, lt: end },
      },
      orderBy: [{ slotDate: 'asc' }, { startTime: 'asc' }],
    });

    const byDate = new Map<string, DoctorSlot[]>();
    for (const slot of slots) {
      const key = formatDate(slot.slotDate);
      const list = byDate.get(key) ?? [];
      list.push(slot);
      byDate.set(key, list);
    }

    const now = new Date();
    const days: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const dateStr = formatDate(date);
      const daySlots = byDate.get(dateStr) ?? [];
      days.push({
        date: dateStr,
        dayName: dayNameOf(date),
        availabilityStatus: daySlots.length > 0 ? 'Available' : 'Unavailable',
        slots: daySlots.map((s) => this.toCalendarSlot(s, now)),
      });
    }

    return {
      doctor: {
        id: doctor.id,
        name: [doctor.firstName, doctor.lastName].filter(Boolean).join(' '),
        department: doctor.department?.name ?? null,
        speciality: doctor.category?.name ?? null,
        branch: doctor.branch?.name ?? null,
        rating: doctor.rating !== null ? Number(doctor.rating) : null,
        yearsOfExperience: this.yearsOfExperience(doctor.experiences),
        role: doctor.doctorType,
        consultationFee: Number(doctor.consultationFee),
      },
      weekStart: formatDate(start),
      days,
    };
  }

  /**
   * Return today's slots for a doctor, with the occupancy ratio (`"2 / 5"`) and
   * a derived availability status (past slots flagged `Past`, full slots `Full`).
   * @param tenantId tenant scope
   * @param doctorId the doctor
   */
  async getTodaySlots(
    tenantId: string,
    doctorId: string,
  ): Promise<TodaySlot[]> {
    const today = startOfUtcDay(new Date());
    const slots = await this.prisma.doctorSlot.findMany({
      where: { tenantId, doctorId, deletedAt: null, slotDate: today },
      orderBy: { startTime: 'asc' },
    });
    const now = new Date();
    return slots.map((s) => {
      const status = this.deriveStatus(s, now);
      return {
        slotId: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        bookedCount: s.bookedPatients,
        maxCapacity: s.maxPatients,
        occupancyRatio: `${s.bookedPatients} / ${s.maxPatients}`,
        occupancyPercentage: this.occupancy(s),
        availabilityStatus: status,
      };
    });
  }

  /**
   * Reserve one place in a slot (increments the booked counter). Rejects past
   * slots and full slots. Wraps {@link reserveInTx} in a tenant transaction.
   * @param tenantId tenant scope
   * @param slotId the slot
   * @returns the updated slot
   * @throws SlotNotFoundException / SlotInPastException / SlotFullException
   */
  async reserve(tenantId: string, slotId: string): Promise<DoctorSlot> {
    return this.prisma.withTenant(tenantId, (tx) =>
      this.reserveInTx(tx, tenantId, slotId),
    );
  }

  /**
   * Reserve one place in a slot inside an existing tenant transaction — lets the
   * order/appointment flow reserve a slot atomically within its own `withTenant`
   * (mirrors `AppointmentService.createInTx`).
   * @param tx active tenant-scoped transaction client
   * @param tenantId tenant scope
   * @param slotId the slot
   * @returns the updated slot
   * @throws SlotNotFoundException / SlotInPastException / SlotFullException
   */
  async reserveInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    slotId: string,
  ): Promise<DoctorSlot> {
    const slot = await this.loadSlot(tx, tenantId, slotId);
    if (this.isPast(slot, new Date())) {
      throw new SlotInPastException(slotId);
    }
    if (slot.bookedPatients >= slot.maxPatients) {
      throw new SlotFullException(slotId);
    }
    const booked = slot.bookedPatients + 1;
    return tx.doctorSlot.update({
      where: { id: slotId },
      data: {
        bookedPatients: booked,
        status:
          booked >= slot.maxPatients ? SlotStatus.FULL : SlotStatus.BOOKED,
      },
    });
  }

  /**
   * Release one place in a slot (decrements the booked counter). Rejects slots
   * with no bookings.
   * @param tenantId tenant scope
   * @param slotId the slot
   * @returns the updated slot
   * @throws SlotNotFoundException / SlotNotBookedException
   */
  async release(tenantId: string, slotId: string): Promise<DoctorSlot> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const slot = await this.loadSlot(tx, tenantId, slotId);
      if (slot.bookedPatients <= 0) {
        throw new SlotNotBookedException(slotId);
      }
      const booked = slot.bookedPatients - 1;
      return tx.doctorSlot.update({
        where: { id: slotId },
        data: {
          bookedPatients: booked,
          status: booked <= 0 ? SlotStatus.AVAILABLE : SlotStatus.BOOKED,
        },
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Load an active slot scoped to the tenant, or throw. */
  private async loadSlot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    slotId: string,
  ): Promise<DoctorSlot> {
    const slot = await tx.doctorSlot.findFirst({
      where: { id: slotId, tenantId, deletedAt: null },
    });
    if (!slot) {
      throw new SlotNotFoundException(slotId);
    }
    return slot;
  }

  /** Shape a slot for the calendar grid, deriving its display status. */
  private toCalendarSlot(slot: DoctorSlot, now: Date): CalendarSlot {
    return {
      slotId: slot.id,
      startTime: slot.startTime,
      endTime: slot.endTime,
      totalCapacity: slot.maxPatients,
      bookedCount: slot.bookedPatients,
      availableCount: Math.max(0, slot.maxPatients - slot.bookedPatients),
      occupancyPercentage: this.occupancy(slot),
      status: this.deriveStatus(slot, now),
    };
  }

  /** Occupancy percentage (0–100), rounded. */
  private occupancy(slot: DoctorSlot): number {
    if (slot.maxPatients <= 0) return 0;
    return Math.round((slot.bookedPatients / slot.maxPatients) * 100);
  }

  /**
   * Derive a slot's display status: `Past` once elapsed, else `Full` at
   * capacity, `Booked` when partially booked, `Available` otherwise.
   */
  private deriveStatus(slot: DoctorSlot, now: Date): SlotDisplayStatus {
    if (this.isPast(slot, now)) return 'Past';
    if (slot.bookedPatients >= slot.maxPatients) return 'Full';
    if (slot.bookedPatients > 0) return 'Booked';
    return 'Available';
  }

  /** True once the slot's end time has elapsed (compared in UTC). */
  private isPast(slot: DoctorSlot, now: Date): boolean {
    const endMinutes = toMinutes(slot.endTime);
    const slotEnd = new Date(slot.slotDate.getTime() + endMinutes * 60_000);
    return slotEnd.getTime() <= now.getTime();
  }

  /**
   * Total years of experience across a doctor's engagements. Each span runs from
   * `fromDate` to `toDate` (or today when open-ended); spans without a start are
   * ignored. Returned as whole years (floored).
   */
  private yearsOfExperience(
    experiences: Array<{ fromDate: Date | null; toDate: Date | null }>,
  ): number {
    const now = Date.now();
    let totalMs = 0;
    for (const exp of experiences) {
      if (!exp.fromDate) continue;
      const from = exp.fromDate.getTime();
      const to = exp.toDate ? exp.toDate.getTime() : now;
      if (to > from) totalMs += to - from;
    }
    return Math.max(0, Math.floor(totalMs / MS_PER_YEAR));
  }
}
