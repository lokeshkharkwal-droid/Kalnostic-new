import { Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  CollectionPriority,
  CollectionStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SlotReservationService } from '../phlebotomist-schedule/slot-reservation.service';
import { AccessionSampleService } from '../accession/accession-sample.service';
import { nextSampleStatus } from '../accession/constants/sample-transitions.constant';
import { PaginatedResult, paginated } from '../../common/dto/response.dto';
import { ListCollectionsDto } from './dto/list-collections.dto';
import { UpdateCollectionStatusDto } from './dto/update-collection-status.dto';
import { RescheduleCollectionDto } from './dto/reschedule-collection.dto';
import { CollectionSummaryQueryDto } from './dto/collection-summary-query.dto';
import {
  COLLECTION_DETAIL_INCLUDE,
  COLLECTION_LIST_INCLUDE,
  CollectionDetail,
  CollectionListRow,
  CollectionSummary,
  PhlebotomistSummaryRow,
  toCollectionListRow,
} from './entities/home-visit-collection.entity';
import {
  CANCELLED_COLLECTION_STATUSES,
  COMPLETED_COLLECTION_STATUSES,
  IN_PROGRESS_COLLECTION_STATUSES,
} from './constants/collection-transitions.constant';
import { CollectionNotFoundException } from './exceptions/phlebotomist-collection.exceptions';

/**
 * Phlebotomist / home sample-collection lifecycle. Tenant-scoped (RLS) +
 * branch-level (CLAUDE.md §4.5/§4.7). Owns the `HomeVisitCollection` record that
 * the Collection Schedule works on: its creation (hooked from `OrderService` when a
 * confirmed order is a home visit), the Collection Schedule list + detail reads,
 * status changes (unrestricted — any status → any status), the reschedule action,
 * and the dashboard/report aggregations.
 *
 * Status transitions are the single source of truth for the field visit and
 * **cascade** to keep the linked records in sync: `SAMPLE_COLLECTED` collects the
 * order's items + accession samples (via `AccessionSampleService` — never writing
 * `SampleStatus` directly), `ACCEPTED_BY_LAB` accepts them, and
 * CONFIRMED/COMPLETED/CANCELLED drive the linked appointment (+ slot release on
 * cancel). Every accession hand-off is guarded (`nextSampleStatus`) so it is a
 * no-op when illegal — the accession module is never disturbed.
 */
@Injectable()
export class PhlebotomistCollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slotReservation: SlotReservationService,
    private readonly accessionSamples: AccessionSampleService,
  ) {}

  // ── Creation hook (order → collection) ─────────────────────────────────────

  /**
   * Create the home-visit collection for an order inside an existing (already
   * tenant-scoped) transaction. Called by `OrderService` after the order +
   * diagnostics are written. Idempotent per order, and a no-op unless the order is
   * a confirmed (ORDER/APPOINTMENT) home visit with an assigned phlebotomist and a
   * collection time — the same set of bookings that consume a phlebotomist slot.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope
   * @param branchId active branch (may be null)
   * @param personId acting person id (created/updated/changed by)
   * @param orderId the order to create the collection for
   */
  async createForOrderInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    orderId: string,
  ): Promise<void> {
    const existing = await tx.homeVisitCollection.count({
      where: { orderId, tenantId, deletedAt: null },
    });
    if (existing > 0) return;

    const order = await tx.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: {
        status: true,
        isUrgentBill: true,
        diagnostics: {
          select: {
            isHomeVisit: true,
            phlebotomistId: true,
            collectionAt: true,
            appointmentAt: true,
            collectionAddress: true,
            geoLocation: true,
          },
        },
      },
    });
    if (
      !order ||
      (order.status !== OrderStatus.ORDER &&
        order.status !== OrderStatus.APPOINTMENT)
    ) {
      return;
    }
    const d = order.diagnostics;
    if (!d?.isHomeVisit || !d.phlebotomistId) return;
    const when = d.collectionAt ?? d.appointmentAt;
    if (!when) return;

    await tx.homeVisitCollection.create({
      data: {
        tenantId,
        branchId,
        orderId,
        phlebotomistId: d.phlebotomistId,
        status: CollectionStatus.SCHEDULED,
        scheduledCollectionAt: when,
        collectionAddress: d.collectionAddress ?? null,
        geoLocation: d.geoLocation ?? null,
        priority: order.isUrgentBill
          ? CollectionPriority.URGENT
          : CollectionPriority.NORMAL,
        createdBy: personId,
        updatedBy: personId,
        statusHistory: {
          create: {
            tenantId,
            branchId,
            status: CollectionStatus.SCHEDULED,
            changedBy: personId,
          },
        },
      },
    });
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /**
   * List home-visit collections for the Collection Schedule (offset pagination),
   * enriched with patient/phlebotomist/financial/sample context. Supports status,
   * phlebotomist, payment-status, referral-panel, priority, a
   * `scheduledCollectionAt` range and a free-text `search`. Branch scope defaults
   * to the active branch; an explicit `query.branchId` overrides it.
   * @param tenantId tenant scope (from JWT)
   * @param activeBranchId active branch (from JWT profile; may be null)
   * @param query filters + pagination
   */
  async findAll(
    tenantId: string,
    activeBranchId: string | null,
    query: ListCollectionsDto,
  ): Promise<PaginatedResult<CollectionListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildListWhere(tenantId, activeBranchId, query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.homeVisitCollection.findMany({
        where,
        include: COLLECTION_LIST_INCLUDE,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { scheduledCollectionAt: 'desc' },
      }),
      this.prisma.homeVisitCollection.count({ where }),
    ]);
    return paginated(rows.map(toCollectionListRow), total, page, limit);
  }

  /**
   * Fetch one collection fully composed (relations + status history) for the
   * Collection Overview modal / audit trail, scoped to the tenant.
   * @param id collection id
   * @param tenantId tenant scope
   * @throws CollectionNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(id: string, tenantId: string): Promise<CollectionDetail> {
    const row = await this.prisma.homeVisitCollection.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: COLLECTION_DETAIL_INCLUDE,
    });
    if (!row) {
      throw new CollectionNotFoundException(id);
    }
    // Resolve each history row's actor id (`changedBy`) to a display name so the
    // Collection Overview audit trail shows a name, not a UID. `Person` is
    // platform-level (no tenant/RLS), so a plain lookup by id is correct.
    const actorIds = [
      ...new Set(
        row.statusHistory
          .map((h) => h.changedBy)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    const actors = actorIds.length
      ? await this.prisma.person.findMany({
          where: { id: { in: actorIds }, deletedAt: null },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nameById = new Map(actors.map((p) => [p.id, this.personName(p)]));
    const statusHistory = row.statusHistory.map((h) => ({
      ...h,
      changedByName: h.changedBy ? (nameById.get(h.changedBy) ?? null) : null,
    }));
    // Carry the derived financials/barcode/counts too, so the detail view has the
    // same enriched shape as a list row (plus the name-resolved statusHistory).
    return { ...row, ...toCollectionListRow(row), statusHistory };
  }

  // ── State machine ────────────────────────────────────────────────────────────

  /**
   * Set a collection to a new status (unrestricted — any status → any status),
   * record a history row, and cascade the change to keep the order items, accession
   * samples and the linked appointment in sync — all atomically. Accession
   * hand-offs are guarded so they never illegally disturb a sample.
   * @param id collection id
   * @param tenantId tenant scope
   * @param personId acting person id (from JWT)
   * @param dto new status + optional notes/gps/attachment/sampleCondition
   * @returns the updated collection with its history
   * @throws CollectionNotFoundException
   */
  async updateStatus(
    id: string,
    tenantId: string,
    personId: string | null,
    dto: UpdateCollectionStatusDto,
  ): Promise<CollectionDetail> {
    // Status changes are unrestricted (any status → any status). The cascade sync
    // below is individually guarded (`nextSampleStatus`, appointment status
    // checks) so it stays a no-op whenever a step doesn't legitimately apply, and
    // every change still writes an audit-trail row.
    const collection = await this.loadForTransition(id, tenantId);

    const now = new Date();
    const target = dto.status;
    const order = collection.order;
    const branchId = collection.branchId;
    const reservation = this.reservationOf(collection);

    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.homeVisitCollection.update({
        where: { id: collection.id },
        data: {
          status: target,
          previousStatus: collection.status,
          updatedBy: personId,
          ...(dto.sampleCondition &&
          target === CollectionStatus.SAMPLE_COLLECTED
            ? { sampleConditionAtCollection: dto.sampleCondition }
            : {}),
          ...(target === CollectionStatus.CANCELLED
            ? { reasonForCancellation: dto.notes ?? null }
            : {}),
        },
      });
      await tx.homeVisitStatusHistory.create({
        data: {
          tenantId,
          branchId,
          collectionId: collection.id,
          status: target,
          fromStatus: collection.status,
          notes: dto.notes ?? null,
          attachmentUrl: dto.attachmentUrl ?? null,
          gpsLocation: dto.gpsLocation ?? null,
          changedBy: personId,
        },
      });

      // ── Cascade sync (idempotent, guarded) ──────────────────────────────────
      if (target === CollectionStatus.SAMPLE_COLLECTED && order) {
        // Order items → collected (mirrors OrderService.collectItem).
        await tx.orderItem.updateMany({
          where: {
            orderId: order.id,
            tenantId,
            deletedAt: null,
            collectedAt: null,
          },
          data: { collectedAt: now, collectedBy: personId },
        });
        // Accession samples → COLLECTED via the accession state machine (only where
        // the `collect` action is legal from the sample's current status).
        for (const s of order.accessionSamples) {
          if (!nextSampleStatus('collect', s.status)) continue;
          await this.accessionSamples.transitionInTx(
            tx,
            tenantId,
            personId,
            s.id,
            'collect',
            (sample) => ({
              data: {
                collectedAt: now,
                collectedBy: personId,
                tubeType: sample.tubeType ?? sample.sampleType ?? undefined,
              },
            }),
            { notes: dto.notes },
          );
        }
      }

      if (target === CollectionStatus.ACCEPTED_BY_LAB && order) {
        for (const s of order.accessionSamples) {
          if (!nextSampleStatus('accept', s.status)) continue;
          await this.accessionSamples.transitionInTx(
            tx,
            tenantId,
            personId,
            s.id,
            'accept',
            () => ({ data: { receivedAt: now, acceptedAt: now } }),
            { notes: dto.notes },
          );
        }
      }

      // Linked appointment sync (inline, mirroring OrderService.cancel).
      const apptStatus = this.appointmentStatusFor(target);
      if (
        apptStatus &&
        order?.appointmentId &&
        order.appointment &&
        order.appointment.status !== apptStatus &&
        order.appointment.status !== AppointmentStatus.CANCELLED
      ) {
        await tx.appointment.update({
          where: { id: order.appointmentId },
          data: { status: apptStatus, updatedBy: personId },
        });
        await tx.appointmentStatusHistory.create({
          data: {
            tenantId,
            branchId: order.appointment.branchId ?? branchId,
            appointmentId: order.appointmentId,
            status: apptStatus,
            notes: `Collection → ${target}`,
            changedBy: personId,
          },
        });
      }

      // Cancelling frees the phlebotomist slot the booking held.
      if (target === CollectionStatus.CANCELLED && reservation) {
        await this.slotReservation.releaseInTx(
          tx,
          tenantId,
          reservation.branchId,
          reservation.phlebotomistId,
          reservation.at,
        );
      }
    });

    return this.findById(id, tenantId);
  }

  /**
   * Reschedule a collection to a new time (optionally reassigning the
   * phlebotomist): release the old phlebotomist slot, reserve the new one (atomic
   * capacity gate), update the order's diagnostics + appointment time, move the
   * collection to `RESCHEDULED`, and sync the linked appointment. All in one
   * transaction — if the new slot can't be booked the whole reschedule rolls back.
   * @param id collection id
   * @param tenantId tenant scope
   * @param personId acting person id (from JWT)
   * @param dto new time + optional phlebotomist / reason / attachment
   * @returns the updated collection with its history
   * @throws CollectionNotFoundException / Slot* exceptions when the new slot can't
   *         be booked
   */
  async reschedule(
    id: string,
    tenantId: string,
    personId: string | null,
    dto: RescheduleCollectionDto,
  ): Promise<CollectionDetail> {
    // Reschedule is unrestricted (allowed from any status, incl. CANCELLED).
    const collection = await this.loadForTransition(id, tenantId);
    const branchId = collection.branchId;
    const newAt = new Date(dto.collectionAt);
    const newPhlebId = dto.phlebotomistId ?? collection.phlebotomistId;
    // A cancelled collection already released its slot at cancel time — releasing
    // again would double-decrement the booking counter, so skip it here.
    const oldReservation =
      collection.status === CollectionStatus.CANCELLED
        ? null
        : this.reservationOf(collection);
    const order = collection.order;

    await this.prisma.withTenant(tenantId, async (tx) => {
      // Release the slot held by the current booking, then reserve the new one
      // (throws + rolls back if the new time can't be booked).
      if (oldReservation) {
        await this.slotReservation.releaseInTx(
          tx,
          tenantId,
          oldReservation.branchId,
          oldReservation.phlebotomistId,
          oldReservation.at,
        );
      }
      if (branchId && newPhlebId) {
        await this.slotReservation.reserveInTx(
          tx,
          tenantId,
          branchId,
          newPhlebId,
          newAt,
        );
      }

      // Keep the order's source-of-truth (diagnostics) + appointment time aligned
      // so slot reconciliation and the collection card agree.
      if (order) {
        await tx.orderDiagnostics.updateMany({
          where: { orderId: order.id, tenantId, deletedAt: null },
          data: { collectionAt: newAt, phlebotomistId: newPhlebId },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { appointmentAt: newAt, updatedBy: personId },
        });
        if (order.appointmentId && order.appointment) {
          await tx.appointment.update({
            where: { id: order.appointmentId },
            data: {
              status: AppointmentStatus.RESCHEDULED,
              updatedBy: personId,
            },
          });
          await tx.appointmentStatusHistory.create({
            data: {
              tenantId,
              branchId: order.appointment.branchId ?? branchId,
              appointmentId: order.appointmentId,
              status: AppointmentStatus.RESCHEDULED,
              notes: dto.reason ?? 'Collection rescheduled',
              changedBy: personId,
            },
          });
        }
      }

      await tx.homeVisitCollection.update({
        where: { id: collection.id },
        data: {
          status: CollectionStatus.RESCHEDULED,
          previousStatus: collection.status,
          scheduledCollectionAt: newAt,
          phlebotomistId: newPhlebId,
          updatedBy: personId,
        },
      });
      await tx.homeVisitStatusHistory.create({
        data: {
          tenantId,
          branchId,
          collectionId: collection.id,
          status: CollectionStatus.RESCHEDULED,
          fromStatus: collection.status,
          notes: dto.reason ?? null,
          attachmentUrl: dto.attachmentUrl ?? null,
          changedBy: personId,
        },
      });
    });

    return this.findById(id, tenantId);
  }

  // ── Aggregations (dashboard + reports) ─────────────────────────────────────

  /**
   * Dashboard summary for the Phlebotomist module: totals + a count per status,
   * completed/pending/cancelled rollups, a per-phlebotomist breakdown, a per-day
   * scheduled-collection trend, and total charges. Honors the same date/branch/
   * phlebotomist filters as the schedule.
   * @param tenantId tenant scope (from JWT)
   * @param activeBranchId active branch (from JWT profile)
   * @param query date/branch/phlebotomist filters
   */
  async summary(
    tenantId: string,
    activeBranchId: string | null,
    query: CollectionSummaryQueryDto,
  ): Promise<CollectionSummary> {
    const where = this.buildSummaryWhere(tenantId, activeBranchId, query);

    const grouped = await this.prisma.homeVisitCollection.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    const byStatus = Object.values(CollectionStatus).reduce(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {} as Record<CollectionStatus, number>,
    );
    let total = 0;
    for (const g of grouped) {
      byStatus[g.status] = g._count._all;
      total += g._count._all;
    }
    const sumStatuses = (statuses: readonly CollectionStatus[]): number =>
      statuses.reduce((s, st) => s + byStatus[st], 0);
    const completed = sumStatuses(COMPLETED_COLLECTION_STATUSES);
    const cancelled = sumStatuses(CANCELLED_COLLECTION_STATUSES);
    const pending = total - completed - cancelled;

    // Rows for the per-phlebotomist + per-day breakdowns + charge totals.
    const rows = await this.prisma.homeVisitCollection.findMany({
      where,
      select: {
        status: true,
        phlebotomistId: true,
        scheduledCollectionAt: true,
        phlebotomist: { select: { firstName: true, lastName: true } },
        order: {
          select: {
            diagnostics: {
              select: { visitCharges: true, sampleCollectionCharges: true },
            },
          },
        },
      },
    });

    const phlebMap = new Map<string, PhlebotomistSummaryRow>();
    const dateMap = new Map<string, number>();
    let totalVisitCharges = 0;
    let totalSampleCollectionCharges = 0;
    for (const r of rows) {
      const visit = r.order?.diagnostics?.visitCharges ?? 0;
      const collect = r.order?.diagnostics?.sampleCollectionCharges ?? 0;
      totalVisitCharges += visit;
      totalSampleCollectionCharges += collect;

      const key = r.phlebotomistId ?? 'unassigned';
      let entry = phlebMap.get(key);
      if (!entry) {
        entry = {
          phlebotomistId: r.phlebotomistId,
          phlebotomistName: this.personName(r.phlebotomist),
          assigned: 0,
          completed: 0,
          pending: 0,
          cancelled: 0,
          totalCharges: 0,
          totalKm: null,
          onTimePercentage: null,
        };
        phlebMap.set(key, entry);
      }
      entry.assigned += 1;
      entry.totalCharges += visit + collect;
      if (COMPLETED_COLLECTION_STATUSES.includes(r.status))
        entry.completed += 1;
      else if (CANCELLED_COLLECTION_STATUSES.includes(r.status)) {
        entry.cancelled += 1;
      } else entry.pending += 1;

      if (r.scheduledCollectionAt) {
        const dateKey = r.scheduledCollectionAt.toISOString().slice(0, 10);
        dateMap.set(dateKey, (dateMap.get(dateKey) ?? 0) + 1);
      }
    }

    const byDate = [...dateMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      total,
      byStatus,
      completed,
      pending,
      cancelled,
      byPhlebotomist: [...phlebMap.values()],
      byDate,
      totalVisitCharges,
      totalSampleCollectionCharges,
    };
  }

  /**
   * Patient-wise report — the same enriched rows as the Collection Schedule, with
   * the report filter set + pagination. (The FE flattens these into report columns.)
   */
  async patientWiseReport(
    tenantId: string,
    activeBranchId: string | null,
    query: ListCollectionsDto,
  ): Promise<PaginatedResult<CollectionListRow>> {
    return this.findAll(tenantId, activeBranchId, query);
  }

  /**
   * Phlebotomist-wise report — per-phlebotomist assigned/completed/pending/
   * cancelled counts + total charges (KM/on-time deferred; no backend source yet).
   * @returns the phlebotomist rollup rows (sorted by assigned desc)
   */
  async phlebotomistWiseReport(
    tenantId: string,
    activeBranchId: string | null,
    query: CollectionSummaryQueryDto,
  ): Promise<PhlebotomistSummaryRow[]> {
    const summary = await this.summary(tenantId, activeBranchId, query);
    return summary.byPhlebotomist.sort((a, b) => b.assigned - a.assigned);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Load a collection with the order context needed to drive + cascade a
   * transition (accession samples, appointment status, branch, diagnostics).
   * @throws CollectionNotFoundException if it doesn't resolve
   */
  private async loadForTransition(id: string, tenantId: string) {
    const collection = await this.prisma.homeVisitCollection.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        status: true,
        branchId: true,
        phlebotomistId: true,
        scheduledCollectionAt: true,
        order: {
          select: {
            id: true,
            appointmentId: true,
            appointment: { select: { status: true, branchId: true } },
            accessionSamples: {
              where: { deletedAt: null },
              select: { id: true, status: true },
            },
          },
        },
      },
    });
    if (!collection) {
      throw new CollectionNotFoundException(id);
    }
    return collection;
  }

  /**
   * The slot reservation held by a collection (branch + phlebotomist + time), or
   * null when it isn't a bookable branch-scoped reservation. Mirrors
   * `OrderService.homeVisitReservation` so release/reserve agree with the counters.
   */
  private reservationOf(collection: {
    branchId: string | null;
    phlebotomistId: string | null;
    scheduledCollectionAt: Date | null;
  }): { branchId: string; phlebotomistId: string; at: Date } | null {
    if (
      !collection.branchId ||
      !collection.phlebotomistId ||
      !collection.scheduledCollectionAt
    ) {
      return null;
    }
    return {
      branchId: collection.branchId,
      phlebotomistId: collection.phlebotomistId,
      at: collection.scheduledCollectionAt,
    };
  }

  /**
   * The appointment status a collection transition should drive the linked
   * appointment to, or null when the transition doesn't map to one.
   */
  private appointmentStatusFor(
    target: CollectionStatus,
  ): AppointmentStatus | null {
    switch (target) {
      case CollectionStatus.CONFIRMED:
        return AppointmentStatus.CONFIRMED;
      case CollectionStatus.STARTED_FROM_CENTER:
      case CollectionStatus.REACHED_PATIENT_LOCATION:
      case CollectionStatus.SAMPLE_COLLECTED:
        return AppointmentStatus.IN_PROGRESS;
      case CollectionStatus.COMPLETED:
        return AppointmentStatus.COMPLETED;
      case CollectionStatus.CANCELLED:
        return AppointmentStatus.CANCELLED;
      default:
        return null;
    }
  }

  /** Build the tenant/branch-scoped `where` for the Collection Schedule list. */
  private buildListWhere(
    tenantId: string,
    activeBranchId: string | null,
    query: ListCollectionsDto,
  ): Prisma.HomeVisitCollectionWhereInput {
    const where: Prisma.HomeVisitCollectionWhereInput = {
      tenantId,
      deletedAt: null,
    };
    const branchId = query.branchId ?? activeBranchId;
    if (branchId) where.branchId = branchId;
    if (query.status) {
      where.status = query.status;
    } else if (query.statusGroup === 'IN_PROGRESS') {
      where.status = { in: [...IN_PROGRESS_COLLECTION_STATUSES] };
    }
    if (query.priority) where.priority = query.priority;
    if (query.phlebotomistId) where.phlebotomistId = query.phlebotomistId;

    if (query.dateFrom || query.dateTo) {
      where.scheduledCollectionAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    // Order-relation filters (payment status / referral panel).
    const order: Prisma.OrderWhereInput = {};
    if (query.paymentStatus) order.paymentStatus = query.paymentStatus;
    if (query.referralPanelId) order.referralPanelId = query.referralPanelId;
    if (query.referredById) order.referredByDoctorId = query.referredById;

    const search = query.search?.trim();
    if (search) {
      order.OR = [
        { orderCode: { contains: search, mode: 'insensitive' } },
        { billId: { contains: search, mode: 'insensitive' } },
        {
          patient: {
            is: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { middleName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { mobile: { contains: search, mode: 'insensitive' } },
                { umId: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
        {
          accessionSamples: {
            some: {
              deletedAt: null,
              barcode: { contains: search, mode: 'insensitive' },
            },
          },
        },
      ];
    }
    if (Object.keys(order).length > 0) where.order = { is: order };
    return where;
  }

  /** Build the tenant/branch-scoped `where` for the summary + phleb-wise report. */
  private buildSummaryWhere(
    tenantId: string,
    activeBranchId: string | null,
    query: CollectionSummaryQueryDto,
  ): Prisma.HomeVisitCollectionWhereInput {
    const where: Prisma.HomeVisitCollectionWhereInput = {
      tenantId,
      deletedAt: null,
    };
    const branchId = query.branchId ?? activeBranchId;
    if (branchId) where.branchId = branchId;
    if (query.phlebotomistId) where.phlebotomistId = query.phlebotomistId;
    if (query.dateFrom || query.dateTo) {
      where.scheduledCollectionAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }
    return where;
  }

  /** Display name for a phlebotomist Person (falls back to "Unassigned"). */
  private personName(
    person: { firstName: string | null; lastName: string | null } | null,
  ): string {
    if (!person) return 'Unassigned';
    return [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
  }
}
