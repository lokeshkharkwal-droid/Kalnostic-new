import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LabReportStatus, RecipientType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoNotificationService } from './services/auto-notification.service';

/** `order.created` — emitted by OrderService.create after the order commits. */
interface OrderCreatedEvent {
  tenantId: string;
  branchId: string | null;
  orderId: string;
  patientId: string | null;
  orderCode: string | null;
}

/** `lab-report.published` — emitted by LabReportService.publish. */
interface LabReportPublishedEvent {
  tenantId: string;
  branchId: string | null;
  reportId: string;
  orderItemId: string;
}

/** `payment.received` — emitted by PaymentDetailsService.create. */
interface PaymentReceivedEvent {
  tenantId: string;
  orderId: string;
  amount: number;
  paymentMode: string | null;
}

/** `order.cancelled` — emitted by OrderService.cancel. */
interface OrderCancelledEvent {
  tenantId: string;
  branchId: string | null;
  orderId: string;
  patientId: string | null;
  orderCode: string | null;
  refundAmount?: number | null;
  currency?: string | null;
}

/** `order.refunded` — emitted by OrderService.refund. */
interface OrderRefundedEvent {
  tenantId: string;
  branchId: string | null;
  orderId: string;
  patientId: string | null;
  orderCode: string | null;
  refundAmount: number;
  currency?: string | null;
}

/** `accession.sample.error` / `accession.sample.repeat` — emitted by OrderSampleService. */
interface SampleFlaggedEvent {
  tenantId: string;
  branchId: string | null;
  sampleId: string;
  orderId: string;
}

/** `patient.updated` — emitted by PatientService.update. */
interface PatientUpdatedEvent {
  tenantId: string;
  branchId: string | null;
  patientId: string;
}

/**
 * `appointment.moved` — emitted by PhlebotomistCollectionService.reschedule and
 * by OrderService.update when an appointment order's `appointmentAt` changes.
 */
interface AppointmentMovedEvent {
  tenantId: string;
  branchId: string | null;
  orderId: string;
  patientId: string | null;
  orderCode: string | null;
  newAppointmentAt: string | Date | null;
}

/**
 * Clinical event → notification bridge. Subscribes to order / report / payment /
 * accession domain events and dispatches the appropriate automatic notification
 * through {@link AutoNotificationService} (template-driven, multi-channel Email /
 * SMS / WhatsApp + in-app IAM, gated by which `Template` rows the tenant has
 * activated). Purely additive and fire-and-forget: each handler swallows + logs
 * its own errors so a messaging failure never affects the already-committed
 * business operation. All DB access runs inside `withTenant` so these
 * out-of-request handlers set the RLS tenant GUC.
 */
@Injectable()
export class ClinicalEventListener {
  private readonly logger = new Logger(ClinicalEventListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auto: AutoNotificationService,
  ) {}

  /**
   * Order confirmation to the patient. For a home-visit order with an assigned
   * phlebotomist, sends the phlebotomist variant INSTEAD of the plain one
   * (mutually exclusive).
   */
  @OnEvent('order.created')
  async onOrderCreated(e: OrderCreatedEvent): Promise<void> {
    if (!e.patientId) return;
    const code = e.orderCode ?? e.orderId;

    // Detect a home-visit-with-phlebotomist order.
    const diag = await this.prisma.withTenant(e.tenantId, (tx) =>
      tx.orderDiagnostics.findFirst({
        where: { orderId: e.orderId, tenantId: e.tenantId },
        select: {
          isHomeVisit: true,
          phlebotomistId: true,
          collectionAt: true,
          appointmentAt: true,
          phlebotomist: { select: { firstName: true, lastName: true } },
        },
      }),
    );

    if (diag?.isHomeVisit && diag.phlebotomistId) {
      const phlebName = diag.phlebotomist
        ? `${diag.phlebotomist.firstName} ${diag.phlebotomist.lastName ?? ''}`.trim()
        : '';
      const collectionAt = diag.collectionAt ?? diag.appointmentAt;
      const when = collectionAt ? this.formatWhen(collectionAt) : '';
      await this.auto.dispatchToPatient(e.tenantId, e.branchId, e.patientId, {
        feature: 'lab_create_order_with_phlebotomist_inform_patient',
        verb: 'order_created_phlebotomist',
        subject:
          `Home collection scheduled ${e.orderCode ? `(${e.orderCode})` : ''}`.trim(),
        variables: {
          order_code: code,
          order_number: code,
          phlebotomist_name: phlebName,
          collection_at: when,
        },
        fallbackHtml: (name) =>
          `<p>Dear ${name},</p><p>Your order <strong>${code}</strong> is booked for home sample collection${when ? ` on <strong>${when}</strong>` : ''}${phlebName ? ` by ${phlebName}` : ''}.</p><p>Thank you.</p>`,
      });
      return;
    }

    await this.auto.dispatchToPatient(e.tenantId, e.branchId, e.patientId, {
      feature: 'lab_create_order_inform_patient',
      verb: 'order_created',
      subject: `Order ${e.orderCode ?? ''} received`.trim(),
      variables: { order_code: code, order_number: code },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>Your order <strong>${code}</strong> has been received and is being processed.</p><p>Thank you.</p>`,
    });
  }

  /** Patient profile updated → confirm the change to the patient. */
  @OnEvent('patient.updated')
  async onPatientUpdated(e: PatientUpdatedEvent): Promise<void> {
    await this.auto.dispatchToPatient(e.tenantId, e.branchId, e.patientId, {
      feature: 'patient_profile_update',
      verb: 'patient_profile_update',
      subject: 'Your profile has been updated',
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>Your profile details have been updated. If you did not make this change, please contact us.</p>`,
    });
  }

  /** Appointment rescheduled (either reschedule path) → inform the patient. */
  @OnEvent('appointment.moved')
  async onAppointmentMoved(e: AppointmentMovedEvent): Promise<void> {
    if (!e.patientId) return;
    const code = e.orderCode ?? e.orderId;
    const when = e.newAppointmentAt ? this.formatWhen(e.newAppointmentAt) : '';
    await this.auto.dispatchToPatient(e.tenantId, e.branchId, e.patientId, {
      feature: 'lab_move_appointment',
      verb: 'appointment_moved',
      subject: 'Your appointment has been rescheduled',
      variables: {
        order_code: code,
        order_number: code,
        aptTimeFmt: when,
      },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>Your appointment${code ? ` for order <strong>${code}</strong>` : ''} has been rescheduled${when ? ` to <strong>${when}</strong>` : ''}.</p>`,
    });
  }

  /**
   * "Report ready" to the patient, plus an order-completed check: when every
   * report for the order is PUBLISHED, notify completion exactly once.
   */
  @OnEvent('lab-report.published')
  async onReportPublished(e: LabReportPublishedEvent): Promise<void> {
    const link = await this.prisma.withTenant(e.tenantId, (tx) =>
      tx.orderItem.findFirst({
        where: { id: e.orderItemId, tenantId: e.tenantId },
        select: {
          order: { select: { id: true, patientId: true, orderCode: true } },
        },
      }),
    );
    const order = link?.order;
    if (!order?.patientId) return;
    const orderCode = order.orderCode ?? '';

    await this.auto.dispatchToPatient(e.tenantId, e.branchId, order.patientId, {
      feature: 'lab_order_report_published_inform_patient',
      verb: 'report_ready',
      subject:
        `Your lab report is ready ${orderCode ? `(${orderCode})` : ''}`.trim(),
      variables: { order_code: orderCode, order_number: orderCode },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>Your lab report${orderCode ? ` for order <strong>${orderCode}</strong>` : ''} is ready. Please contact the lab or log in to view it.</p>`,
    });

    await this.maybeNotifyOrderCompleted(
      e.tenantId,
      e.branchId,
      order.id,
      order.patientId,
      orderCode,
    );
  }

  /**
   * Payment acknowledgement to the patient. Picks the complete- vs
   * partial-payment feature from the order's recomputed `paymentStatus`.
   */
  @OnEvent('payment.received')
  async onPaymentReceived(e: PaymentReceivedEvent): Promise<void> {
    const order = await this.prisma.withTenant(e.tenantId, (tx) =>
      tx.order.findFirst({
        where: { id: e.orderId, tenantId: e.tenantId },
        select: { patientId: true, orderCode: true, paymentStatus: true },
      }),
    );
    const patientId = order?.patientId ?? null;
    if (!patientId) return;
    const orderCode = order?.orderCode ?? '';
    const amount = e.amount.toFixed(2);
    const isComplete = order?.paymentStatus === 'PAID';
    const feature = isComplete
      ? 'complete_payment_for_lab_order_inform_patient'
      : 'partial_payment_for_lab_order_inform_patient';
    await this.auto.dispatchToPatient(e.tenantId, null, patientId, {
      feature,
      verb: 'payment_received',
      subject: `Payment received ${orderCode ? `for ${orderCode}` : ''}`.trim(),
      variables: { amount, order_code: orderCode, order_number: orderCode },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>We have received your payment of <strong>${amount}</strong>${orderCode ? ` towards order <strong>${orderCode}</strong>` : ''}.${isComplete ? '' : ' A balance may remain on this order.'} Thank you.</p>`,
    });
  }

  /** Order cancellation to the patient (mentions the refund when present). */
  @OnEvent('order.cancelled')
  async onOrderCancelled(e: OrderCancelledEvent): Promise<void> {
    if (!e.patientId) return;
    const code = e.orderCode ?? e.orderId;
    const currency = e.currency ?? '';
    const refundLine =
      e.refundAmount && e.refundAmount > 0
        ? ` A refund of ${currency} ${e.refundAmount.toFixed(2)} will be processed.`
        : '';
    await this.auto.dispatchToPatient(e.tenantId, e.branchId, e.patientId, {
      feature: 'order_cancelled_inform_patient',
      verb: 'order_cancelled',
      subject: `Order ${e.orderCode ?? ''} cancelled`.trim(),
      variables: {
        order_code: code,
        order_number: code,
        ...(e.refundAmount
          ? { amount: e.refundAmount.toFixed(2), currency }
          : {}),
      },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>Your order <strong>${code}</strong> has been cancelled.${refundLine}</p>`,
    });
  }

  /** Refund confirmation to the patient. */
  @OnEvent('order.refunded')
  async onOrderRefunded(e: OrderRefundedEvent): Promise<void> {
    if (!e.patientId) return;
    const code = e.orderCode ?? e.orderId;
    const currency = e.currency ?? '';
    const amount = e.refundAmount.toFixed(2);
    await this.auto.dispatchToPatient(e.tenantId, e.branchId, e.patientId, {
      feature: 'lab_order_report_refund_inform_patient',
      verb: 'order_refunded',
      subject: `Refund processed ${code ? `for ${code}` : ''}`.trim(),
      variables: { amount, currency, order_code: code, order_number: code },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>A refund of <strong>${currency} ${amount}</strong>${code ? ` for order <strong>${code}</strong>` : ''} has been processed. Thank you.</p>`,
    });
  }

  /** Sample error reported → inform the order's referring panel (B2B). */
  @OnEvent('accession.sample.error')
  async onSampleError(e: SampleFlaggedEvent): Promise<void> {
    await this.notifyReferralPanel(e, 'error');
  }

  /** Sample repeat required → inform the order's referring panel (B2B). */
  @OnEvent('accession.sample.repeat')
  async onSampleRepeat(e: SampleFlaggedEvent): Promise<void> {
    await this.notifyReferralPanel(e, 'repeat');
  }

  /** Compact UTC-ish display of a date/time (e.g. "2026-08-25 10:30 UTC"). */
  private formatWhen(d: string | Date): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return `${dt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }

  /**
   * Notify a completed order once. When every `LabReport` on the order is
   * PUBLISHED, flip `Order.completionNotifiedAt` (conditional on it being null,
   * so concurrent last-item publishes can't double-send) and dispatch.
   */
  private async maybeNotifyOrderCompleted(
    tenantId: string,
    branchId: string | null,
    orderId: string,
    patientId: string,
    orderCode: string,
  ): Promise<void> {
    try {
      const shouldNotify = await this.prisma.withTenant(
        tenantId,
        async (tx) => {
          const reports = await tx.labReport.findMany({
            where: { tenantId, deletedAt: null, orderItem: { orderId } },
            select: { status: true },
          });
          if (reports.length === 0) return false;
          const allPublished = reports.every(
            (r) => r.status === LabReportStatus.PUBLISHED,
          );
          if (!allPublished) return false;
          // Claim the once-only send: only the first caller to flip the flag wins.
          const claimed = await tx.order.updateMany({
            where: { id: orderId, tenantId, completionNotifiedAt: null },
            data: { completionNotifiedAt: new Date() },
          });
          return claimed.count > 0;
        },
      );
      if (!shouldNotify) return;

      await this.auto.dispatchToPatient(tenantId, branchId, patientId, {
        feature: 'lab_order_completed_inform_patient',
        verb: 'order_completed',
        subject:
          `Your order is complete ${orderCode ? `(${orderCode})` : ''}`.trim(),
        variables: { order_code: orderCode, order_number: orderCode },
        fallbackHtml: (name) =>
          `<p>Dear ${name},</p><p>All tests for your order${orderCode ? ` <strong>${orderCode}</strong>` : ''} are complete and reports are available.</p><p>Thank you.</p>`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Order-completed check failed for order ${orderId}: ${message}`,
      );
    }
  }

  /** Resolve the order's referral panel + patient and inform the panel's accession contact. */
  private async notifyReferralPanel(
    e: SampleFlaggedEvent,
    kind: 'error' | 'repeat',
  ): Promise<void> {
    try {
      const data = await this.prisma.withTenant(e.tenantId, (tx) =>
        tx.order.findFirst({
          where: { id: e.orderId, tenantId: e.tenantId },
          select: {
            orderCode: true,
            referralPanel: {
              select: {
                name: true,
                accessionPersonName: true,
                accessionPersonEmail: true,
                accessionPersonMobile: true,
                directorEmail: true,
                directorMobile: true,
              },
            },
            patient: { select: { firstName: true, lastName: true } },
          },
        }),
      );
      const panel = data?.referralPanel;
      if (!panel) return; // walk-in / non-B2B order → nothing to send
      const email = panel.accessionPersonEmail ?? panel.directorEmail ?? null;
      const mobile =
        panel.accessionPersonMobile ?? panel.directorMobile ?? null;
      if (!email && !mobile) return;

      const patientName = [data?.patient?.firstName, data?.patient?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      const orderCode = data?.orderCode ?? '';
      const feature =
        kind === 'error'
          ? 'lab_report_sample_error_inform_referring_panel'
          : 'lab_report_sample_repeat_inform_referring_panel';
      const label =
        kind === 'error'
          ? 'a sample error was reported'
          : 'a sample repeat / re-collection is required';

      await this.auto.dispatchToContact(
        e.tenantId,
        e.branchId,
        {
          recipientType: RecipientType.CUSTOM,
          name: panel.name || panel.accessionPersonName || 'Referring Panel',
          email,
          mobile,
          whatsappNumber: null,
        },
        {
          feature,
          verb: kind === 'error' ? 'sample_error' : 'sample_repeat',
          subject: `Sample ${kind} for order ${orderCode}`.trim(),
          variables: {
            referring_panel_name: panel.name ?? '',
            patient_name: patientName,
            order_number: orderCode,
            order_code: orderCode,
          },
          fallbackHtml: (name) =>
            `<p>Dear ${name},</p><p>For order <strong>${orderCode}</strong>${patientName ? ` (${patientName})` : ''}, ${label}. Please take the necessary action.</p>`,
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Referral-panel ${kind} notify failed for order ${e.orderId}: ${message}`,
      );
    }
  }
}
