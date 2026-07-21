import { Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  DoctorScheduleStatus,
  DoctorType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import {
  DoctorListSortBy,
  ListScheduleDoctorsDto,
} from './dto/list-schedule-doctors.dto';
import { DoctorScheduleListRow } from './entities/doctor-schedule.entity';

/** Columns selected for a Doctor List row. */
const LIST_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  status: true,
  consultationFee: true,
  followUpFee: true,
  branch: { select: { name: true } },
  department: { select: { name: true } },
  category: { select: { name: true } },
} satisfies Prisma.DoctorSelect;

type ListRow = Prisma.DoctorGetPayload<{ select: typeof LIST_SELECT }>;

/** A list row enriched with the dynamic counts and current status. */
interface EnrichedRow {
  doctorId: string;
  name: string;
  branch: string | null;
  department: string | null;
  speciality: string | null;
  initialConsultationFee: number;
  followUpConsultationFee: number;
  assignedAppointments: number;
  completedAppointments: number;
  status: ListRow['status'];
  currentStatus: 'Active' | 'On Leave';
}

/**
 * Doctor List (Tab 1) read model. Lists the tenant's CONSULTANT doctors enriched
 * with **dynamically computed** appointment counts (from `OrderOpd` →
 * `Order.appointment`) and a current status derived from the doctor's schedule.
 * Tenant-scoped (CLAUDE.md §4.7): every query carries `tenantId` and filters
 * soft-deleted rows.
 *
 * Because assigned/completed counts and current status aren't stored columns,
 * the full filtered set is loaded, enriched, sorted, and paginated in memory —
 * correct for the modest per-tenant doctor count.
 */
@Injectable()
export class DoctorListService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List CONSULTANT doctors with appointment counts and current status.
   * @param tenantId tenant scope
   * @param query pagination + `search`/`branchId`/`departmentId`/`specialityId`/
   *   `status` filters + `sortBy`/`sortOrder`
   */
  async list(
    tenantId: string,
    query: ListScheduleDoctorsDto,
  ): Promise<PaginatedResult<DoctorScheduleListRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.DoctorWhereInput = {
      tenantId,
      deletedAt: null,
      doctorType: DoctorType.CONSULTANT,
    };
    if (query.status) where.status = query.status;
    if (query.branchId) where.branchId = query.branchId;
    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.specialityId) where.categoryId = query.specialityId;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const doctors = await this.prisma.doctor.findMany({
      where,
      select: LIST_SELECT,
    });
    const doctorIds = doctors.map((d) => d.id);

    const [assigned, completed, onLeave] = await Promise.all([
      this.countAppointments(tenantId, doctorIds, false),
      this.countAppointments(tenantId, doctorIds, true),
      this.onLeaveDoctorIds(tenantId, doctorIds),
    ]);

    const enriched: EnrichedRow[] = doctors.map((d) => ({
      doctorId: d.id,
      name: [d.firstName, d.lastName].filter(Boolean).join(' '),
      branch: d.branch?.name ?? null,
      department: d.department?.name ?? null,
      speciality: d.category?.name ?? null,
      initialConsultationFee: Number(d.consultationFee),
      followUpConsultationFee: Number(d.followUpFee),
      assignedAppointments: assigned.get(d.id) ?? 0,
      completedAppointments: completed.get(d.id) ?? 0,
      status: d.status,
      currentStatus: onLeave.has(d.id) ? 'On Leave' : 'Active',
    }));

    this.sort(enriched, query.sortBy, query.sortOrder ?? 'asc');

    const total = enriched.length;
    const start = (page - 1) * limit;
    const pageRows = enriched.slice(start, start + limit);
    const data: DoctorScheduleListRow[] = pageRows.map((r, i) => ({
      srNo: start + i + 1,
      ...r,
    }));

    return { data, total, page, limit };
  }

  /**
   * Active department `{ id, name }` options for the tenant (dropdown source).
   * @param tenantId tenant scope
   */
  async departmentOptions(
    tenantId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.department.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Active speciality (category) `{ id, name }` options for the tenant.
   * @param tenantId tenant scope
   */
  async specialityOptions(
    tenantId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.category.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Count appointments per doctor from OPD order sections whose order carries a
   * linked appointment. `completedOnly` restricts to COMPLETED appointments;
   * otherwise all non-CANCELLED appointments count as assigned.
   */
  private async countAppointments(
    tenantId: string,
    doctorIds: string[],
    completedOnly: boolean,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (doctorIds.length === 0) return result;

    const grouped = await this.prisma.orderOpd.groupBy({
      by: ['doctorId'],
      where: {
        tenantId,
        deletedAt: null,
        doctorId: { in: doctorIds },
        order: {
          deletedAt: null,
          appointmentId: { not: null },
          appointment: {
            deletedAt: null,
            status: completedOnly
              ? AppointmentStatus.COMPLETED
              : { not: AppointmentStatus.CANCELLED },
          },
        },
      },
      _count: { _all: true },
    });
    for (const g of grouped) {
      result.set(g.doctorId, g._count._all);
    }
    return result;
  }

  /** Doctor ids that currently have a (non-deleted) ON_LEAVE schedule. */
  private async onLeaveDoctorIds(
    tenantId: string,
    doctorIds: string[],
  ): Promise<Set<string>> {
    if (doctorIds.length === 0) return new Set();
    const rows = await this.prisma.doctorSchedule.findMany({
      where: {
        tenantId,
        deletedAt: null,
        doctorId: { in: doctorIds },
        status: DoctorScheduleStatus.ON_LEAVE,
      },
      select: { doctorId: true },
      distinct: ['doctorId'],
    });
    return new Set(rows.map((r) => r.doctorId));
  }

  /** Sort enriched rows in place by the requested column (default: name asc). */
  private sort(
    rows: EnrichedRow[],
    sortBy: DoctorListSortBy | undefined,
    order: 'asc' | 'desc',
  ): void {
    const key = sortBy ?? 'name';
    const dir = order === 'desc' ? -1 : 1;
    rows.sort((a, b) => this.compare(a, b, key) * dir);
  }

  /** Compare two rows by a sort column (strings case-insensitive; numbers numeric). */
  private compare(
    a: EnrichedRow,
    b: EnrichedRow,
    key: DoctorListSortBy,
  ): number {
    switch (key) {
      case 'initialConsultationFee':
        return a.initialConsultationFee - b.initialConsultationFee;
      case 'followUpConsultationFee':
        return a.followUpConsultationFee - b.followUpConsultationFee;
      case 'assignedAppointments':
        return a.assignedAppointments - b.assignedAppointments;
      case 'completedAppointments':
        return a.completedAppointments - b.completedAppointments;
      case 'branch':
        return this.cmpStr(a.branch, b.branch);
      case 'department':
        return this.cmpStr(a.department, b.department);
      case 'speciality':
        return this.cmpStr(a.speciality, b.speciality);
      case 'status':
        return this.cmpStr(a.status, b.status);
      case 'name':
      default:
        return this.cmpStr(a.name, b.name);
    }
  }

  /** Case-insensitive string compare, nulls last. */
  private cmpStr(a: string | null, b: string | null): number {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  }
}
