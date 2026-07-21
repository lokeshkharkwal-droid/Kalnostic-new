import { Injectable } from '@nestjs/common';
import {
  Appointment,
  AppointmentStatus,
  AppointmentStatusHistory,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SlotReservationService } from '../phlebotomist-schedule/slot-reservation.service';
import { PaginatedResult, paginated } from '../../common/dto/response.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
import {
  APPOINTMENT_INCLUDE,
  AppointmentWithHistory,
} from './entities/appointment.entity';
import {
  AppointmentCodeConflictException,
  AppointmentNotFoundException,
} from './exceptions/appointment.exceptions';

/**
 * Appointment status tracking. Tenant-scoped (RLS) + branch-level
 * (CLAUDE.md §4.5/§4.7). An appointment holds the CURRENT status; every change
 * is appended to `AppointmentStatusHistory` in the same transaction so the full
 * lifecycle history is preserved. `tenantId`/`branchId` come from the request
 * context; `code` (`APT-00001`…) is system-generated from
 * `Tenant.appointmentCounter`. Reads always filter `{ tenantId, deletedAt: null }`.
 */
@Injectable()
export class AppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slotReservation: SlotReservationService,
  ) {}

  /**
   * Resolve the home-visit slot reservation held by an appointment's linked order,
   * or null when it is not a capacity-consuming home-visit booking. Mirrors the
   * occupancy derivation: reservation time is `collectionAt ?? appointmentAt`.
   */
  private homeVisitReservation(
    branchId: string | null,
    d:
      | {
          isHomeVisit?: boolean | null;
          phlebotomistId?: string | null;
          collectionAt?: Date | null;
          appointmentAt?: Date | null;
        }
      | null
      | undefined,
  ): { branchId: string; phlebotomistId: string; at: Date } | null {
    if (!branchId || !d?.isHomeVisit || !d.phlebotomistId) return null;
    const when = d.collectionAt ?? d.appointmentAt;
    if (!when) return null;
    return { branchId, phlebotomistId: d.phlebotomistId, at: new Date(when) };
  }

  /**
   * Create an appointment and record its initial status in the history log.
   * Generates a per-tenant sequential `code`; the whole write runs in one
   * `withTenant` transaction.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile; may be null)
   * @param personId acting person id (from JWT) — recorded as created/updated by
   * @param dto validated payload
   * @returns the created appointment with its history
   * @throws AppointmentCodeConflictException on a counter race (retryable)
   */
  async create(
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    dto: CreateAppointmentDto,
  ): Promise<AppointmentWithHistory> {
    let createdId: string;
    try {
      createdId = await this.prisma.withTenant(tenantId, (tx) =>
        this.createInTx(tx, tenantId, branchId, personId, dto),
      );
    } catch (e) {
      this.rethrowConflict(e);
      throw e;
    }
    return this.findById(createdId, tenantId);
  }

  /**
   * Create an appointment + its initial status-history row inside an existing
   * transaction, returning the new appointment id. Lets another module (the
   * order module) create a linked appointment atomically within its own
   * `withTenant` transaction — avoids nesting a second `withTenant`.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope
   * @param branchId active branch (may be null)
   * @param personId acting person id (created/updated/changed by)
   * @param dto validated payload (initial status defaults to `NEW`)
   * @returns the created appointment's id
   */
  async createInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string | null,
    personId: string | null,
    dto: CreateAppointmentDto,
  ): Promise<string> {
    const status = dto.status ?? AppointmentStatus.NEW;
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { appointmentCounter: { increment: 1 } },
      select: { appointmentCounter: true },
    });
    const code = `APT-${String(tenant.appointmentCounter).padStart(5, '0')}`;
    const appointment = await tx.appointment.create({
      data: {
        tenantId,
        branchId,
        code,
        appointmentType: dto.appointmentType,
        status,
        createdBy: personId,
        updatedBy: personId,
        statusHistory: {
          create: {
            tenantId,
            branchId,
            status,
            notes: dto.notes ?? null,
            changedBy: personId,
          },
        },
      },
    });
    return appointment.id;
  }

  /**
   * List appointments for the active branch, paginated + filterable.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param query pagination + optional `search` / `status` / `appointmentType`
   * @returns a page of appointments (newest first)
   */
  async findAll(
    tenantId: string,
    branchId: string | null,
    query: ListAppointmentsDto,
  ): Promise<PaginatedResult<Appointment>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.AppointmentWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.appointmentType
        ? { appointmentType: query.appointmentType }
        : {}),
      ...(query.search
        ? { code: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return paginated(data, total, page, limit);
  }

  /**
   * Fetch one appointment (with its status history) scoped to the tenant.
   * @param id appointment id
   * @param tenantId tenant scope
   * @throws AppointmentNotFoundException if missing/soft-deleted/other tenant
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<AppointmentWithHistory> {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: APPOINTMENT_INCLUDE,
    });
    if (!appointment) {
      throw new AppointmentNotFoundException(id);
    }
    return appointment;
  }

  /**
   * Return an appointment's status-history log (newest first), tenant-scoped.
   * @param id appointment id
   * @param tenantId tenant scope
   * @throws AppointmentNotFoundException if the appointment is missing
   */
  async findHistory(
    id: string,
    tenantId: string,
  ): Promise<AppointmentStatusHistory[]> {
    await this.findById(id, tenantId);
    return this.prisma.appointmentStatusHistory.findMany({
      where: { appointmentId: id, tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Transition an appointment to a new status: update the current `status` and
   * append a history row, atomically. `updatedBy` / `changedBy` are the acting
   * person from the JWT.
   * @param id appointment id
   * @param tenantId tenant scope
   * @param personId acting person id (from JWT)
   * @param dto new status + optional notes
   * @returns the updated appointment with its history
   * @throws AppointmentNotFoundException if missing/soft-deleted/other tenant
   */
  async updateStatus(
    id: string,
    tenantId: string,
    personId: string | null,
    dto: UpdateAppointmentStatusDto,
  ): Promise<AppointmentWithHistory> {
    const existing = await this.findById(id, tenantId);
    // Linked order booking — cancelling frees the phlebotomist slot; reactivating
    // (out of CANCELLED) re-reserves it.
    const order = await this.prisma.order.findFirst({
      where: { appointmentId: id, tenantId, deletedAt: null },
      select: {
        branchId: true,
        diagnostics: {
          select: {
            isHomeVisit: true,
            phlebotomistId: true,
            collectionAt: true,
            appointmentAt: true,
          },
        },
      },
    });
    const reservation = this.homeVisitReservation(
      order?.branchId ?? null,
      order?.diagnostics,
    );
    const wasCancelled = existing.status === AppointmentStatus.CANCELLED;
    const willCancel = dto.status === AppointmentStatus.CANCELLED;
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.appointment.update({
        where: { id: existing.id },
        data: { status: dto.status, updatedBy: personId },
      });
      await tx.appointmentStatusHistory.create({
        data: {
          tenantId,
          branchId: existing.branchId,
          appointmentId: existing.id,
          status: dto.status,
          notes: dto.notes ?? null,
          changedBy: personId,
        },
      });
      if (reservation) {
        if (willCancel && !wasCancelled) {
          await this.slotReservation.releaseInTx(
            tx,
            tenantId,
            reservation.branchId,
            reservation.phlebotomistId,
            reservation.at,
          );
        } else if (!willCancel && wasCancelled) {
          await this.slotReservation.reserveInTx(
            tx,
            tenantId,
            reservation.branchId,
            reservation.phlebotomistId,
            reservation.at,
          );
        }
      }
    });
    return this.findById(id, tenantId);
  }

  /**
   * Soft-delete an appointment (sets `deletedAt`; history rows are preserved).
   * @param id appointment id
   * @param tenantId tenant scope
   * @throws AppointmentNotFoundException if missing/soft-deleted/other tenant
   */
  async remove(id: string, tenantId: string): Promise<Appointment> {
    await this.findById(id, tenantId);
    return this.prisma.appointment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Translate a Prisma unique-constraint violation (the per-tenant appointment
   * `code`) into a typed, retryable 409.
   */
  private rethrowConflict(e: unknown): void {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new AppointmentCodeConflictException('');
    }
  }
}
