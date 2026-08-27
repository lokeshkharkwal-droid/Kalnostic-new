import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppointmentStatus, RecipientType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoNotificationService } from './services/auto-notification.service';

/** An appointment due for a reminder, with the data needed to dispatch. */
interface DueAppointment {
  appointmentId: string;
  orderCode: string | null;
  branchId: string | null;
  patientId: string;
  appointmentAt: Date;
  branchName: string | null;
  doctor: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string;
  } | null;
}

/**
 * Background worker that sends the ~24h-ahead appointment reminder to the patient
 * (and, for OPD appointments, the assigned doctor) exactly once per appointment.
 * Runs hourly; an appointment is picked up as soon as it falls within the next
 * 24h and `reminderSentAt` is still null.
 *
 * ## RLS safety (mirrors `CommunicationWorkerService`)
 * The cron has no request/tenant context, so it enumerates the platform-level
 * `tenants` table (no RLS) and does every read/write for a tenant inside
 * `prisma.withTenant(tenantId, …)`. The reminder is *claimed* (stamp
 * `reminderSentAt` via a conditional `updateMany`) before dispatch, so an
 * overlapping tick or a slow send never double-notifies. Gated by the same
 * `COMMUNICATION_WORKER_ENABLED` flag as the queue drain so it runs on exactly
 * one instance per environment.
 */
@Injectable()
export class AppointmentReminderWorkerService {
  private readonly logger = new Logger(AppointmentReminderWorkerService.name);
  /** Guards against overlapping runs. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auto: AutoNotificationService,
  ) {}

  /** Send due reminders once per hour across all tenants. Never throws. */
  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<number> {
    if (!this.config.get<boolean>('communication.workerEnabled')) return 0;
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.runOnce();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Appointment reminder run failed: ${message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** One pass across all tenants. Extracted for testability. */
  private async runOnce(): Promise<number> {
    const now = new Date();
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });

    let sent = 0;
    for (const { id: tenantId } of tenants) {
      try {
        const due = await this.findDue(tenantId, now, until);
        for (const appt of due) {
          // Claim the once-only send before dispatching (guards overlap/races).
          const claimed = await this.prisma.withTenant(tenantId, (tx) =>
            tx.appointment.updateMany({
              where: { id: appt.appointmentId, tenantId, reminderSentAt: null },
              data: { reminderSentAt: now },
            }),
          );
          if (claimed.count === 0) continue;
          await this.dispatchReminder(tenantId, appt);
          sent++;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Appointment reminders failed for tenant ${tenantId}: ${message}`,
        );
      }
    }
    return sent;
  }

  /** Appointments in the next 24h that are still active and unreminded. */
  private async findDue(
    tenantId: string,
    now: Date,
    until: Date,
  ): Promise<DueAppointment[]> {
    const orders = await this.prisma.withTenant(tenantId, (tx) =>
      tx.order.findMany({
        where: {
          tenantId,
          deletedAt: null,
          appointmentAt: { gt: now, lte: until },
          appointment: {
            is: {
              status: {
                in: [AppointmentStatus.NEW, AppointmentStatus.CONFIRMED],
              },
              reminderSentAt: null,
            },
          },
        },
        select: {
          orderCode: true,
          branchId: true,
          patientId: true,
          appointmentAt: true,
          appointmentId: true,
          branch: { select: { name: true } },
          opd: {
            select: {
              doctor: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
        },
      }),
    );

    const due: DueAppointment[] = [];
    for (const o of orders) {
      if (!o.appointmentId || !o.appointmentAt) continue;
      due.push({
        appointmentId: o.appointmentId,
        orderCode: o.orderCode,
        branchId: o.branchId,
        patientId: o.patientId,
        appointmentAt: o.appointmentAt,
        branchName: o.branch?.name ?? null,
        doctor: o.opd?.doctor ?? null,
      });
    }
    return due;
  }

  /** Dispatch the patient reminder and (for OPD) the doctor reminder. */
  private async dispatchReminder(
    tenantId: string,
    appt: DueAppointment,
  ): Promise<void> {
    const when = this.formatAppt(appt.appointmentAt);
    const location = appt.branchName ?? '';
    const orderCode = appt.orderCode ?? '';
    const doctorName = appt.doctor
      ? `${appt.doctor.firstName} ${appt.doctor.lastName}`.trim()
      : '';

    // Patient.
    await this.auto.dispatchToPatient(tenantId, appt.branchId, appt.patientId, {
      feature: 'appointment_reminder_inform_patient',
      verb: 'appointment_reminder',
      subject: 'Appointment reminder',
      variables: {
        order_code: orderCode,
        order_number: orderCode,
        aptTimeFmt: when,
        aptLocation: location,
        dn: doctorName,
      },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>This is a reminder for your appointment${when ? ` on <strong>${when}</strong>` : ''}${location ? ` at ${location}` : ''}${doctorName ? ` with Dr. ${doctorName}` : ''}.</p>`,
    });

    // Doctor (OPD only, when a contact exists).
    const doctor = appt.doctor;
    if (doctor && (doctor.email || doctor.phone)) {
      await this.auto.dispatchToContact(
        tenantId,
        appt.branchId,
        {
          recipientType: RecipientType.DOCTOR,
          name: doctorName || 'Doctor',
          email: doctor.email,
          mobile: doctor.phone,
          whatsappNumber: doctor.phone,
        },
        {
          feature: 'appointment_reminder_inform_doctor',
          verb: 'appointment_reminder',
          subject: 'Appointment reminder',
          variables: {
            aptTimeFmt: when,
            aptLocation: location,
            order_code: orderCode,
            order_number: orderCode,
          },
          fallbackHtml: (name) =>
            `<p>Dear Dr. ${name},</p><p>You have an appointment${when ? ` on <strong>${when}</strong>` : ''}${location ? ` at ${location}` : ''}.</p>`,
        },
      );
    }
  }

  /** Compact UTC-ish display of the appointment time (e.g. "2026-08-25 10:30 UTC"). */
  private formatAppt(d: Date): string {
    return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }
}
