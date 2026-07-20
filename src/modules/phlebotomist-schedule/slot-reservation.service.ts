import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  PhlebotomistScheduleStatus,
  PhlebotomistSlot,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DailyCapReachedException,
  PhlebotomistScheduleForStaffNotFoundException,
  SlotFullException,
  SlotUnavailableException,
} from './exceptions/phlebotomist-schedule.exceptions';
import {
  addDays,
  formatDate,
  startOfUtcDay,
  toMinutes,
  utcMinutesOf,
} from './utils/schedule-time.util';

/**
 * Maintains the persisted home-visit reservation counters
 * (`PhlebotomistSlot.bookedCount` + `PhlebotomistDayLoad.bookedCount`) that gate
 * booking concurrency. Every method runs **inside** the caller's transaction so
 * the reservation commits atomically with the order/appointment write.
 *
 * Capacity is enforced with conditional atomic updates (`bookedCount < capacity`)
 * rather than a read-modify-write, so two concurrent bookings can never exceed
 * `slotCapacity` (per slot) or `maxVisitsPerDay` (per day) — the losing
 * transaction sees zero affected rows and is rejected.
 *
 * The counters are a denormalization of the business truth in `OrderDiagnostics`;
 * `reconcile()` recomputes them from that source of truth (used for the migration
 * backfill and to self-heal any drift).
 */
@Injectable()
export class SlotReservationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserve one home-visit opening for `phlebotomistId` at `collectionAt`,
   * enforcing the slot capacity and the daily cap atomically. Call this inside the
   * order/appointment transaction when a home-visit booking is being created (or
   * (re)activated).
   * @throws PhlebotomistScheduleForStaffNotFoundException when the phlebotomist has
   *         no ACTIVE schedule (booking is blocked — per product decision).
   * @throws SlotUnavailableException when the time maps to no bookable slot
   *         (off-window / holiday / off-day / past).
   * @throws SlotFullException when the slot is already at `slotCapacity`.
   * @throws DailyCapReachedException when the day is at `maxVisitsPerDay`.
   */
  async reserveInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    phlebotomistId: string,
    collectionAt: Date,
  ): Promise<void> {
    const schedule = await tx.phlebotomistSchedule.findFirst({
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
    if (!schedule) {
      throw new PhlebotomistScheduleForStaffNotFoundException(phlebotomistId);
    }

    const slot = await this.resolveSlot(
      tx,
      tenantId,
      branchId,
      phlebotomistId,
      collectionAt,
    );
    if (!slot || collectionAt.getTime() < Date.now()) {
      throw new SlotUnavailableException(
        phlebotomistId,
        collectionAt.toISOString(),
      );
    }

    // Atomic slot-capacity gate: only increments while there is room.
    const slotReserved = await tx.phlebotomistSlot.updateMany({
      where: {
        id: slot.id,
        deletedAt: null,
        bookedCount: { lt: slot.slotCapacity },
      },
      data: { bookedCount: { increment: 1 } },
    });
    if (slotReserved.count === 0) {
      throw new SlotFullException(phlebotomistId, collectionAt.toISOString());
    }

    // Atomic daily-cap gate. `maxVisitsPerDay <= 0` means "no daily cap".
    if (schedule.maxVisitsPerDay > 0) {
      const loadDate = startOfUtcDay(collectionAt);
      await tx.phlebotomistDayLoad.upsert({
        where: {
          tenantId_phlebotomistId_branchId_loadDate: {
            tenantId,
            phlebotomistId,
            branchId,
            loadDate,
          },
        },
        create: {
          tenantId,
          branchId,
          phlebotomistId,
          loadDate,
          bookedCount: 0,
        },
        update: {},
      });
      const dayReserved = await tx.phlebotomistDayLoad.updateMany({
        where: {
          tenantId,
          phlebotomistId,
          branchId,
          loadDate,
          deletedAt: null,
          bookedCount: { lt: schedule.maxVisitsPerDay },
        },
        data: { bookedCount: { increment: 1 } },
      });
      if (dayReserved.count === 0) {
        // Roll the whole transaction back so the slot increment is undone too.
        throw new DailyCapReachedException(
          phlebotomistId,
          formatDate(loadDate),
        );
      }
    }
  }

  /**
   * Release one previously-reserved opening (cancel / reschedule-away / delete).
   * Best-effort and floored at zero — never throws, so it is safe to call in
   * teardown paths even if the schedule/slot has since changed.
   */
  async releaseInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    phlebotomistId: string,
    collectionAt: Date,
  ): Promise<void> {
    const slot = await this.resolveSlot(
      tx,
      tenantId,
      branchId,
      phlebotomistId,
      collectionAt,
    );
    if (slot) {
      await tx.phlebotomistSlot.updateMany({
        where: { id: slot.id, bookedCount: { gt: 0 } },
        data: { bookedCount: { decrement: 1 } },
      });
    }
    const loadDate = startOfUtcDay(collectionAt);
    await tx.phlebotomistDayLoad.updateMany({
      where: {
        tenantId,
        phlebotomistId,
        branchId,
        loadDate,
        bookedCount: { gt: 0 },
      },
      data: { bookedCount: { decrement: 1 } },
    });
  }

  /**
   * Recompute the slot + day-load counters for a phlebotomist over `[from, to)`
   * from the business truth in `OrderDiagnostics`. Used for the migration backfill
   * and to correct any drift. Not transactional by default — pass a `tx` to run it
   * within one.
   */
  async reconcile(
    tenantId: string,
    branchId: string,
    phlebotomistId: string,
    from: Date,
    to: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    // Business truth: confirmed (APPOINTMENT/ORDER), non-cancelled home-visit
    // diagnostics for this phlebotomist in range. Queried via `client` so it
    // honours the caller's tenant (RLS) context. Mirrors the exact predicate used
    // by PhlebotomistDirectoryService.visitTimesInRange and homeVisitReservation,
    // so the counter, the derived occupancy, and this reconcile stay in agreement.
    // Cancelled orders flip to status CANCELLED, so the status filter drops them.
    const rows = await client.orderDiagnostics.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        phlebotomistId,
        isHomeVisit: true,
        order: {
          deletedAt: null,
          status: { in: [OrderStatus.APPOINTMENT, OrderStatus.ORDER] },
        },
        OR: [
          { collectionAt: { gte: from, lt: to } },
          { collectionAt: null, appointmentAt: { gte: from, lt: to } },
        ],
      },
      select: { collectionAt: true, appointmentAt: true },
    });
    const minutesByDate = new Map<string, number[]>();
    const countByDate = new Map<string, number>();
    for (const r of rows) {
      const v = r.collectionAt ?? r.appointmentAt;
      if (!v || v < from || v >= to) continue;
      const key = formatDate(v);
      const list = minutesByDate.get(key) ?? [];
      list.push(utcMinutesOf(v));
      minutesByDate.set(key, list);
      countByDate.set(key, (countByDate.get(key) ?? 0) + 1);
    }

    const slots = await client.phlebotomistSlot.findMany({
      where: {
        tenantId,
        branchId,
        phlebotomistId,
        deletedAt: null,
        slotDate: { gte: from, lt: to },
      },
    });
    for (const slot of slots) {
      const mins = minutesByDate.get(formatDate(slot.slotDate)) ?? [];
      const start = toMinutes(slot.startTime);
      const end = toMinutes(slot.endTime);
      const booked = mins.filter((m) => m >= start && m < end).length;
      if (booked !== slot.bookedCount) {
        await client.phlebotomistSlot.update({
          where: { id: slot.id },
          data: { bookedCount: booked },
        });
      }
    }

    for (const [dateKey, count] of countByDate) {
      const loadDate = startOfUtcDay(new Date(`${dateKey}T00:00:00.000Z`));
      await client.phlebotomistDayLoad.upsert({
        where: {
          tenantId_phlebotomistId_branchId_loadDate: {
            tenantId,
            phlebotomistId,
            branchId,
            loadDate,
          },
        },
        create: {
          tenantId,
          branchId,
          phlebotomistId,
          loadDate,
          bookedCount: count,
        },
        update: { bookedCount: count },
      });
    }
  }

  /**
   * Find the bookable slot whose `[startTime, endTime)` window contains
   * `collectionAt`, for the phlebotomist on that date. Returns null when none
   * matches (off-window / holiday / off-day — such dates generate no slots).
   */
  private async resolveSlot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    phlebotomistId: string,
    collectionAt: Date,
  ): Promise<PhlebotomistSlot | null> {
    const dayStart = startOfUtcDay(collectionAt);
    const candidates = await tx.phlebotomistSlot.findMany({
      where: {
        tenantId,
        branchId,
        phlebotomistId,
        deletedAt: null,
        slotDate: { gte: dayStart, lt: addDays(dayStart, 1) },
      },
    });
    const minute = utcMinutesOf(collectionAt);
    return (
      candidates.find(
        (s) =>
          minute >= toMinutes(s.startTime) && minute < toMinutes(s.endTime),
      ) ?? null
    );
  }
}
