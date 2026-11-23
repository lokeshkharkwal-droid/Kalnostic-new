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

/**
 * Read-only data for the patient portal, scoped to the authenticated patient
 * within their active tenant. Every read filters `{ tenantId, …, deletedAt: null }`
 * (and the patient's own `patientId`); the request already carries the patient's
 * RLS tenant context (set from the patient JWT), so isolation is enforced twice.
 * The home summary is best-effort — a thin/absent source yields a zero/empty
 * value rather than failing the whole page.
 */
@Injectable()
export class PatientPortalService {
  private readonly logger = new Logger(PatientPortalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compose the patient-portal home summary: identity, the four stat tiles, the
   * next appointment, recent ready reports, and recent messages.
   *
   * **Tenant-level, all-branches consolidation.** The portal has no branch filter:
   * once a tenant is selected, the dashboard shows the patient's records from
   * EVERY branch of that tenant. Patients are tenant-scoped (their orders /
   * appointments / reports carry their own `branchId`), so this filters only by
   * the person's patient record(s) + `tenantId` — never by branch. It also
   * aggregates across **all** patient rows the person holds in the tenant, so a
   * person registered at more than one branch is still consolidated into one view.
   *
   * @param tenantId active tenant (from the patient JWT)
   * @param personId the authenticated platform person (from the patient JWT)
   * @param patientId the patient row the session acts as (identity display)
   * @throws NotFoundException when the patient doesn't exist in the tenant
   */
  async getHome(
    tenantId: string,
    personId: string,
    patientId: string,
  ): Promise<PatientPortalHome> {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId, deletedAt: null },
      select: {
        id: true,
        salutation: true,
        firstName: true,
        middleName: true,
        lastName: true,
        photoUrl: true,
        person: { select: { platformMrn: true, photoUrl: true } },
      },
    });
    if (!patient) {
      throw new NotFoundException('Patient', patientId);
    }

    // Every patient record this person holds in the tenant (normally one, but a
    // person registered across branches may have more). Scoped to the person +
    // tenant from the token — never cross-patient — and never filtered by branch.
    const patientRows = await this.prisma.patient.findMany({
      where: { tenantId, personId, deletedAt: null },
      select: { id: true },
    });
    const patientIds = [
      ...new Set([patient.id, ...patientRows.map((p) => p.id)]),
    ];

    const [tenant, upcomingAppointments, nextAppointment, reports, balance] =
      await Promise.all([
        this.prisma.tenant.findFirst({
          where: { id: tenantId },
          select: { name: true },
        }),
        this.countUpcomingAppointments(tenantId, patientIds),
        this.findNextAppointment(tenantId, patientIds),
        this.findReadyReports(tenantId, patientIds),
        this.computeBalance(tenantId, patientIds),
      ]);

    const name = this.composeName(patient);
    return {
      patient: {
        patientId: patient.id,
        name,
        initials: this.initials(patient.firstName, patient.lastName),
        platformMrn: patient.person?.platformMrn ?? null,
        photoUrl: patient.photoUrl ?? patient.person?.photoUrl ?? null,
        tenantId,
        tenantName: tenant?.name ?? '',
      },
      stats: {
        upcomingAppointments,
        reportsReady: reports.total,
        unreadMessages: 0, // no patient inbox model yet — surfaced as empty.
        balanceDue: balance.balanceDue,
        billsCount: balance.billsCount,
      },
      nextAppointment,
      reportsReady: reports.items,
      recentMessages: [],
    };
  }

  /**
   * List the businesses (labs) this patient can switch into, for the portal's
   * lab switcher. Read from the platform-level `person_tenant_enrollments` index
   * joined to `tenants`.
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
