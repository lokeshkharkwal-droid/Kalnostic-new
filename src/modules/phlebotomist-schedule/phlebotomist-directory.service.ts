import { Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  OrderStatus,
  Prisma,
  StaffStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PhlebotomistNotFoundException } from './exceptions/phlebotomist-schedule.exceptions';

/** AuthRole key that identifies a phlebotomist staff Person. */
const PHLEBOTOMIST_ROLE_KEY = 'phlebotomist';

/** Milliseconds in a (Julian) year, for tenure maths. */
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Appointment statuses that count as "assigned" (active workload). */
const ASSIGNED_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.NEW,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.IN_PROGRESS,
];

/** Statuses of a visit currently in the field (drives the "On Route" status). */
const ON_ROUTE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.IN_PROGRESS,
];

/** Which visit metric to count. */
export type VisitCountKind = 'assigned' | 'completed' | 'total';

/** Minimal Person fields used across the phlebotomist-schedule read models. */
export interface PhlebPersonBasics {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
}

/** A branch phlebotomist profile: the person and their per-branch status. */
export interface BranchPhlebProfile {
  personId: string;
  branchStatus: StaffStatus;
}

/**
 * Resolves phlebotomists (staff Persons holding the `phlebotomist` role at a
 * branch) and derives their visit statistics from `OrderDiagnostics` →
 * `Order.appointment`. There is **no phlebotomist master table** (CLAUDE.md §4.2)
 * — this service is the module's single source of truth for "who is a
 * phlebotomist at this branch" and "how many visits have they handled".
 *
 * Tenant-scoped + branch-level (CLAUDE.md §4.7): every query carries `tenantId`
 * and filters soft-deleted rows. Uses `PrismaService` directly (the DB layer);
 * no cross-service imports.
 */
@Injectable()
export class PhlebotomistDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All phlebotomist profiles at a branch (any per-branch status), deduplicated
   * to one row per person (preferring an ACTIVE profile). Drives the Tab-1 list,
   * which shows inactive phlebotomists too.
   */
  async branchProfiles(
    tenantId: string,
    branchId: string,
  ): Promise<BranchPhlebProfile[]> {
    const rows = await this.prisma.userBranchProfile.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        authRole: { key: PHLEBOTOMIST_ROLE_KEY },
      },
      select: { personId: true, branchStatus: true },
    });
    const byPerson = new Map<string, StaffStatus>();
    for (const r of rows) {
      const current = byPerson.get(r.personId);
      if (current !== StaffStatus.ACTIVE) {
        byPerson.set(r.personId, r.branchStatus);
      }
    }
    return [...byPerson].map(([personId, branchStatus]) => ({
      personId,
      branchStatus,
    }));
  }

  /**
   * Assert `personId` is an ACTIVE phlebotomist at the branch and return their
   * Person basics.
   * @throws PhlebotomistNotFoundException if no active matching profile exists
   */
  async assertActivePhlebotomist(
    tenantId: string,
    branchId: string,
    personId: string,
  ): Promise<PhlebPersonBasics> {
    const profile = await this.prisma.userBranchProfile.findFirst({
      where: {
        tenantId,
        branchId,
        personId,
        deletedAt: null,
        branchStatus: StaffStatus.ACTIVE,
        authRole: { key: PHLEBOTOMIST_ROLE_KEY },
      },
      select: { id: true },
    });
    if (!profile) {
      throw new PhlebotomistNotFoundException(personId);
    }
    const person = await this.personBasics(personId);
    if (!person) {
      throw new PhlebotomistNotFoundException(personId);
    }
    return person;
  }

  /** Person basics for a set of ids, keyed by id (active persons only). */
  async personsByIds(
    personIds: string[],
  ): Promise<Map<string, PhlebPersonBasics>> {
    const result = new Map<string, PhlebPersonBasics>();
    if (personIds.length === 0) return result;
    const rows = await this.prisma.person.findMany({
      where: { id: { in: personIds }, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
      },
    });
    for (const r of rows) result.set(r.id, r);
    return result;
  }

  /** Person basics for a single id, or null when missing/soft-deleted. */
  async personBasics(personId: string): Promise<PhlebPersonBasics | null> {
    return this.prisma.person.findFirst({
      where: { id: personId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
      },
    });
  }

  /**
   * Whole years since the phlebotomist joined this tenant (their earliest active
   * staff membership), used as a proxy for "years of experience". Null when no
   * membership exists.
   */
  async tenureYears(
    tenantId: string,
    personId: string,
  ): Promise<number | null> {
    const membership = await this.prisma.tenantStaffMembership.findFirst({
      where: { tenantId, personId, deletedAt: null },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) return null;
    const ms = Date.now() - membership.createdAt.getTime();
    return Math.max(0, Math.floor(ms / MS_PER_YEAR));
  }

  /**
   * Count visits per phlebotomist from diagnostic order sections whose order
   * carries a linked appointment, by metric kind.
   */
  async countVisits(
    tenantId: string,
    branchId: string,
    personIds: string[],
    kind: VisitCountKind,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (personIds.length === 0) return result;
    const grouped = await this.prisma.orderDiagnostics.groupBy({
      by: ['phlebotomistId'],
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        phlebotomistId: { in: personIds },
        order: {
          deletedAt: null,
          appointmentId: { not: null },
          appointment: {
            deletedAt: null,
            status: this.statusFilter(kind),
          },
        },
      },
      _count: { _all: true },
    });
    for (const g of grouped) {
      if (g.phlebotomistId) result.set(g.phlebotomistId, g._count._all);
    }
    return result;
  }

  /**
   * Person ids currently "on route" — with a home-visit diagnostic whose linked
   * appointment is CHECKED_IN/IN_PROGRESS and whose visit time is today.
   */
  async onRoutePersonIds(
    tenantId: string,
    branchId: string,
    personIds: string[],
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Set<string>> {
    if (personIds.length === 0) return new Set();
    const rows = await this.prisma.orderDiagnostics.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        phlebotomistId: { in: personIds },
        isHomeVisit: true,
        order: {
          deletedAt: null,
          appointmentId: { not: null },
          appointment: {
            deletedAt: null,
            status: { in: ON_ROUTE_STATUSES },
          },
        },
        OR: [
          { collectionAt: { gte: dayStart, lt: dayEnd } },
          { collectionAt: null, appointmentAt: { gte: dayStart, lt: dayEnd } },
        ],
      },
      select: { phlebotomistId: true },
      distinct: ['phlebotomistId'],
    });
    return new Set(
      rows.flatMap((r) => (r.phlebotomistId ? [r.phlebotomistId] : [])),
    );
  }

  /**
   * Visit timestamps (`collectionAt ?? appointmentAt`) for a phlebotomist's
   * home-visit bookings within `[start, end)`. Used to derive slot occupancy and
   * the delete/regenerate booked-guard.
   *
   * Counts **all committed home-visit orders** — both `APPOINTMENT` (scheduled)
   * and `ORDER` (immediate) — for the phlebotomist, excluding uncommitted
   * (`DRAFT`/`QUOTE`) and `CANCELLED` orders. `OrderService.cancel()` sets
   * `order.status = CANCELLED` (and cancels any linked appointment) together, so
   * the order-status filter alone drops cancelled bookings.
   */
  async visitTimesInRange(
    tenantId: string,
    branchId: string,
    personId: string,
    start: Date,
    end: Date,
  ): Promise<Date[]> {
    const rows = await this.prisma.orderDiagnostics.findMany({
      where: {
        tenantId,
        branchId,
        deletedAt: null,
        phlebotomistId: personId,
        isHomeVisit: true,
        order: {
          deletedAt: null,
          status: { in: [OrderStatus.APPOINTMENT, OrderStatus.ORDER] },
        },
        OR: [
          { collectionAt: { gte: start, lt: end } },
          { collectionAt: null, appointmentAt: { gte: start, lt: end } },
        ],
      },
      select: { collectionAt: true, appointmentAt: true },
    });
    const times: Date[] = [];
    for (const r of rows) {
      const t = r.collectionAt ?? r.appointmentAt;
      if (t && t >= start && t < end) times.push(t);
    }
    return times;
  }

  /** Map a count kind to its appointment-status filter. */
  private statusFilter(
    kind: VisitCountKind,
  ): Prisma.AppointmentWhereInput['status'] {
    switch (kind) {
      case 'completed':
        return { equals: AppointmentStatus.COMPLETED };
      case 'assigned':
        return { in: ASSIGNED_STATUSES };
      case 'total':
      default:
        return { not: AppointmentStatus.CANCELLED };
    }
  }
}
