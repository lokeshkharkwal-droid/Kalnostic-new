import { Injectable, Logger } from '@nestjs/common';
import {
  AppointmentStatus,
  LabReportStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '../../common/exceptions/kaltros.exception';
import type {
  PatientPortalBusiness,
  PatientPortalHome,
  PatientPortalNextAppointment,
  PatientPortalReport,
} from './entities/patient-home.entity';

/** Appointment statuses that are no longer "upcoming". */
const TERMINAL_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.COMPLETED,
  AppointmentStatus.CANCELLED,
  AppointmentStatus.RESCHEDULED,
];

/** Order statuses that carry a real (billable) balance. */
const BILLABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.ORDER,
  OrderStatus.APPOINTMENT,
];

const MAX_REPORTS = 5;

/** One business's slice of the home summary (before cross-business merge). */
interface TenantHomeSlice {
  upcoming: number;
  next: PatientPortalNextAppointment | null;
  reports: { total: number; items: PatientPortalReport[] };
  balance: { balanceDue: number; billsCount: number };
}

/**
 * Read-only data for the patient portal. **Person-scoped, cross-business.** The
 * portal no longer pins to a single selected tenant — a patient enrolled in more
 * than one business sees their records from EVERY business consolidated in one
 * view. For each enrolled tenant the reads run inside that tenant's RLS context
 * (`runWithTenant`) and still filter `{ tenantId, …, deletedAt: null }` (and the
 * person's own `patientId`), so isolation is enforced twice; results are merged
 * in the app layer. The home summary is best-effort — a thin/absent source
 * yields a zero/empty value rather than failing the whole page.
 */
@Injectable()
export class PatientPortalService {
  private readonly logger = new Logger(PatientPortalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The businesses (id + name) a person is enrolled in — the basis for every
   * cross-business aggregation in the portal. Read from the platform-level
   * (RLS-exempt) `person_tenant_enrollments` index joined to `tenants`, so no
   * tenant context is required.
   * @param personId the authenticated patient's platform person id
   */
  async getEnrolledTenants(
    personId: string,
  ): Promise<{ tenantId: string; tenantName: string }[]> {
    const enrolments = await this.prisma.personTenantEnrollment.findMany({
      where: { personId, deletedAt: null },
      select: { tenantId: true },
    });
    const tenantIds = [...new Set(enrolments.map((e) => e.tenantId))];
    if (tenantIds.length === 0) {
      return [];
    }
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return tenants.map((t) => ({ tenantId: t.id, tenantName: t.name }));
  }

  /**
   * Compose the patient-portal home summary: identity, the four stat tiles, the
   * next appointment, recent ready reports, and recent messages — **consolidated
   * across every business the person is enrolled in** (and, within each, every
   * branch). Identity comes from the platform `Person`; the stats aggregate each
   * tenant's slice (counts/balances summed, the single earliest next appointment,
   * the most-recent published reports across all businesses).
   *
   * @param personId the authenticated platform person (from the patient JWT)
   * @throws NotFoundException when the person no longer exists
   */
  async getHome(personId: string): Promise<PatientPortalHome> {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, deletedAt: null },
      select: {
        id: true,
        salutation: true,
        firstName: true,
        middleName: true,
        lastName: true,
        platformMrn: true,
        photoUrl: true,
      },
    });
    if (!person) {
      throw new NotFoundException('Patient', personId);
    }

    const tenants = await this.getEnrolledTenants(personId);
    const slices = await Promise.all(
      tenants.map((t) => this.getTenantHomeSlice(t.tenantId, personId)),
    );

    const upcomingAppointments = slices.reduce((s, r) => s + r.upcoming, 0);
    const reportsReadyTotal = slices.reduce((s, r) => s + r.reports.total, 0);
    const balanceDue = slices.reduce((s, r) => s + r.balance.balanceDue, 0);
    const billsCount = slices.reduce((s, r) => s + r.balance.billsCount, 0);

    const nextAppointment =
      slices
        .map((r) => r.next)
        .filter((n): n is PatientPortalNextAppointment => n !== null)
        .sort((a, b) => this.apptTime(a) - this.apptTime(b))[0] ?? null;

    const reportsReady = slices
      .flatMap((r) => r.reports.items)
      .sort((a, b) => this.publishedTime(b) - this.publishedTime(a))
      .slice(0, MAX_REPORTS);

    const name = this.composeName(person);
    return {
      patient: {
        patientId: '',
        name,
        initials: this.initials(person.firstName, person.lastName),
        platformMrn: person.platformMrn,
        photoUrl: person.photoUrl ?? null,
        // No single active tenant any more — the view spans all businesses.
        tenantId: '',
        tenantName:
          tenants.length === 1
            ? (tenants[0]?.tenantName ?? '')
            : 'All businesses',
      },
      stats: {
        upcomingAppointments,
        reportsReady: reportsReadyTotal,
        unreadMessages: 0, // no patient inbox model yet — surfaced as empty.
        balanceDue,
        billsCount,
      },
      nextAppointment,
      reportsReady,
      recentMessages: [],
    };
  }

  /**
   * List the businesses (labs) this patient belongs to. Read from the
   * platform-level `person_tenant_enrollments` index joined to `tenants`.
   * @param personId the authenticated patient's person id
   */
  async getBusinesses(personId: string): Promise<PatientPortalBusiness[]> {
    const enrolments = await this.prisma.personTenantEnrollment.findMany({
      where: { personId, deletedAt: null },
      select: { tenantId: true },
    });
    const tenantIds = [...new Set(enrolments.map((e) => e.tenantId))];
    if (tenantIds.length === 0) {
      return [];
    }
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        shortName: true,
        logoUrl: true,
      },
      orderBy: { name: 'asc' },
    });
    return tenants.map((t) => ({
      tenantId: t.id,
      tenantName: t.name,
      tenantSlug: t.slug,
      shortName: t.shortName,
      logoUrl: t.logoUrl,
    }));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * One business's home slice, read under that tenant's RLS context and scoped to
   * the person's patient record(s) in it (all branches). A person not actually
   * registered in the tenant yields an empty slice.
   */
  private getTenantHomeSlice(
    tenantId: string,
    personId: string,
  ): Promise<TenantHomeSlice> {
    return this.prisma.runWithTenant(tenantId, async () => {
      const patientRows = await this.prisma.patient.findMany({
        where: { tenantId, personId, deletedAt: null },
        select: { id: true },
      });
      const patientIds = patientRows.map((p) => p.id);
      if (patientIds.length === 0) {
        return {
          upcoming: 0,
          next: null,
          reports: { total: 0, items: [] },
          balance: { balanceDue: 0, billsCount: 0 },
        };
      }
      const [upcoming, next, reports, balance] = await Promise.all([
        this.countUpcomingAppointments(tenantId, patientIds),
        this.findNextAppointment(tenantId, patientIds),
        this.findReadyReports(tenantId, patientIds),
        this.computeBalance(tenantId, patientIds),
      ]);
      return { upcoming, next, reports, balance };
    });
  }

  /** Sort key for the earliest upcoming appointment (nulls sort last). */
  private apptTime(a: PatientPortalNextAppointment): number {
    return a.appointmentAt ? new Date(a.appointmentAt).getTime() : Infinity;
  }

  /** Sort key for the most-recently published report (nulls sort last). */
  private publishedTime(r: PatientPortalReport): number {
    return r.publishedAt ? new Date(r.publishedAt).getTime() : 0;
  }

  /**
   * Count the patient's upcoming (non-terminal, future-dated) appointments,
   * across every branch (filtered by the person's patient ids, not by branch).
   */
  private countUpcomingAppointments(
    tenantId: string,
    patientIds: string[],
  ): Promise<number> {
    return this.prisma.order.count({
      where: {
        tenantId,
        patientId: { in: patientIds },
        deletedAt: null,
        status: OrderStatus.APPOINTMENT,
        appointmentAt: { gte: this.startOfToday() },
        appointment: { status: { notIn: TERMINAL_APPOINTMENT_STATUSES } },
      },
    });
  }

  /**
   * The single next upcoming appointment (across all branches) with doctor +
   * branch. The branch name is shown for context only — it never filters.
   */
  private async findNextAppointment(
    tenantId: string,
    patientIds: string[],
  ): Promise<PatientPortalNextAppointment | null> {
    const order = await this.prisma.order.findFirst({
      where: {
        tenantId,
        patientId: { in: patientIds },
        deletedAt: null,
        status: OrderStatus.APPOINTMENT,
        appointmentAt: { gte: this.startOfToday() },
        appointment: { status: { notIn: TERMINAL_APPOINTMENT_STATUSES } },
      },
      orderBy: { appointmentAt: 'asc' },
      select: {
        orderCode: true,
        appointmentAt: true,
        appointmentType: true,
        orderNotes: true,
        branch: { select: { name: true } },
        appointment: { select: { status: true } },
        opd: {
          select: {
            doctor: {
              select: { salutation: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });
    if (!order) {
      return null;
    }
    const doc = order.opd?.doctor;
    const doctorName = doc
      ? [doc.salutation, doc.firstName, doc.lastName]
          .filter((p): p is string => !!p && p.trim().length > 0)
          .join(' ')
      : null;
    return {
      orderCode: order.orderCode,
      appointmentAt: order.appointmentAt?.toISOString() ?? null,
      appointmentType: order.appointmentType,
      doctorName,
      branchName: order.branch?.name ?? null,
      reason: order.orderNotes ?? null,
      status: order.appointment?.status ?? null,
    };
  }

  /**
   * The patient's most-recently published reports + the total ready count,
   * across every branch of the tenant.
   */
  private async findReadyReports(
    tenantId: string,
    patientIds: string[],
  ): Promise<{ total: number; items: PatientPortalReport[] }> {
    const where: Prisma.LabReportWhereInput = {
      tenantId,
      deletedAt: null,
      status: LabReportStatus.PUBLISHED,
      orderItem: {
        order: { patientId: { in: patientIds }, tenantId, deletedAt: null },
      },
    };
    const [total, rows] = await Promise.all([
      this.prisma.labReport.count({ where }),
      this.prisma.labReport.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        take: MAX_REPORTS,
        select: {
          id: true,
          publishedAt: true,
          orderItem: {
            select: {
              branchLabTest: {
                select: { testDisplayName: true, testName: true },
              },
              branchLabPanel: { select: { panelName: true } },
              order: { select: { orderCode: true } },
            },
          },
        },
      }),
    ]);
    const items: PatientPortalReport[] = rows.map((r) => ({
      id: r.id,
      testName:
        r.orderItem?.branchLabTest?.testDisplayName ??
        r.orderItem?.branchLabTest?.testName ??
        r.orderItem?.branchLabPanel?.panelName ??
        'Report',
      orderCode: r.orderItem?.order?.orderCode ?? null,
      publishedAt: r.publishedAt?.toISOString() ?? null,
    }));
    return { total, items };
  }

  /**
   * Total outstanding balance (whole rupees) + the number of bills with a due,
   * summed across every branch of the tenant.
   */
  private async computeBalance(
    tenantId: string,
    patientIds: string[],
  ): Promise<{ balanceDue: number; billsCount: number }> {
    const where: Prisma.OrderWhereInput = {
      tenantId,
      patientId: { in: patientIds },
      deletedAt: null,
      status: { in: BILLABLE_ORDER_STATUSES },
    };
    const [sum, billsCount] = await Promise.all([
      this.prisma.order.aggregate({
        where,
        _sum: { balanceAmount: true },
      }),
      this.prisma.order.count({
        where: { ...where, balanceAmount: { gt: 0 } },
      }),
    ]);
    return { balanceDue: sum._sum.balanceAmount ?? 0, billsCount };
  }

  /** Midnight (local server time) today — the lower bound for "upcoming". */
  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Compose a display name from the patient's name parts. */
  private composeName(patient: {
    salutation: string | null;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
  }): string {
    return [
      patient.salutation,
      patient.firstName,
      patient.middleName,
      patient.lastName,
    ]
      .filter((p): p is string => !!p && p.trim().length > 0)
      .join(' ');
  }

  /** Uppercase initials from first/last name for the avatar. */
  private initials(firstName: string, lastName: string | null): string {
    const a = firstName.trim().charAt(0);
    const b = (lastName ?? '').trim().charAt(0);
    return `${a}${b}`.toUpperCase() || a.toUpperCase();
  }
}
