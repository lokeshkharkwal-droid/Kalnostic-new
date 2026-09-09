/**
 * amn.csv notification test driver. Triggers every Automatic event + every Manual
 * (Share & Inform) flow for ONE tenant against a test patient repointed to the
 * real inbox, then captures the `communication_logs` / `notifications` rows each
 * produced — proving which template was SELECTED (by feature+channel) and whether
 * the Exchange accepted it. It REUSES the real services/listeners (faithful path);
 * where a listener reads only its event payload (cancel/refund/business/staff) the
 * domain event is emitted directly with real ids, exactly as the producer would.
 *
 * This process's queue worker is OFF — the already-running backend server drains
 * the queue. Results are written to scripts/amn-results.json.
 *
 * Run:  pnpm ts-node --transpile-only -r tsconfig-paths/register scripts/test-amn-notifications.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PatientService } from '../src/modules/patient/patient.service';
import { OrderService } from '../src/modules/order/order.service';
import { LabReportService } from '../src/modules/lab-report/lab-report.service';

process.env.COMMUNICATION_WORKER_ENABLED = 'false';
const logger = new Logger('TestAmn');

const TENANT = '92f6e838-3779-4a74-a823-c1a8e50e2248';
const BRANCH = 'c99cf11b-db4d-4da1-9474-4b90fca87546';
const ACTOR = '51f3772e-f548-4f14-a8c7-18d9b57e6070'; // priya
const INBOX_EMAIL = 'lokesh.kharkwal@kalnostic.com';
const INBOX_MOBILE = '9634834856';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const events = app.get(EventEmitter2);
  const patients = app.get(PatientService);
  const orders = app.get(OrderService);
  const labReports = app.get(LabReportService);

  const steps: { key: string; note: string }[] = [];
  const record = (key: string, note: string) => {
    steps.push({ key, note });
    logger.log(`${key}: ${note}`);
  };

  // ── Resolve the test patient + repoint contacts to the real inbox ──
  const patient = await prisma.withTenant(TENANT, (tx) =>
    tx.patient.findFirst({
      where: {
        tenantId: TENANT,
        deletedAt: null,
        mobile: { in: ['9634824856', INBOX_MOBILE] },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
  if (!patient) throw new Error('No candidate test patient found');
  const patientId = patient.id;

  const t0 = new Date();

  // Row: patient_profile_update — repoint email/mobile/whatsapp (emits patient.updated)
  try {
    await patients.update(
      patientId,
      TENANT,
      {
        email: INBOX_EMAIL,
        mobile: INBOX_MOBILE,
        whatsappNumber: INBOX_MOBILE,
      },
      { branchId: BRANCH, actorId: ACTOR },
    );
    record(
      'patient_profile_update',
      `patient ${patientId} repointed to inbox + patient.updated emitted`,
    );
  } catch (e) {
    record('patient_profile_update', `FAILED: ${(e as Error).message}`);
  }

  // ── Orders owned by the test patient ──
  const patientOrders = await prisma.withTenant(TENANT, (tx) =>
    tx.order.findMany({
      where: { tenantId: TENANT, patientId, deletedAt: null },
      select: {
        id: true,
        orderCode: true,
        branchId: true,
        paymentStatus: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
  const paid =
    patientOrders.find((o) => o.paymentStatus === 'PAID') ?? patientOrders[0];
  const partial =
    patientOrders.find((o) => o.paymentStatus === 'PARTIALLY_PAID') ?? paid;
  if (!paid) throw new Error('Test patient has no orders to drive events');
  const oid = paid.id;
  const ocode = paid.orderCode ?? oid;
  const obranch = paid.branchId ?? BRANCH;
  record(
    '_setup',
    `paid order ${ocode} (${oid}); partial order ${partial?.orderCode}`,
  );

  // ── Automatic: order lifecycle events (listeners read event payload / re-fetch order) ──
  await events.emitAsync('order.created', {
    tenantId: TENANT,
    branchId: obranch,
    orderId: oid,
    patientId,
    orderCode: ocode,
  });
  record('lab_create_order_inform_patient', 'order.created emitted');

  await events.emitAsync('order.cancelled', {
    tenantId: TENANT,
    branchId: obranch,
    orderId: oid,
    patientId,
    orderCode: ocode,
    refundAmount: 100,
    currency: 'INR',
  });
  record(
    'order_cancelled_inform_patient',
    'order.cancelled emitted (with refund)',
  );

  await events.emitAsync('order.refunded', {
    tenantId: TENANT,
    branchId: obranch,
    orderId: oid,
    patientId,
    orderCode: ocode,
    refundAmount: 100,
    currency: 'INR',
  });
  record('lab_order_report_refund_inform_patient', 'order.refunded emitted');

  await events.emitAsync('appointment.moved', {
    tenantId: TENANT,
    branchId: obranch,
    orderId: oid,
    patientId,
    orderCode: ocode,
    newAppointmentAt: new Date(Date.now() + 2 * 864e5).toISOString(),
  });
  record('lab_move_appointment', 'appointment.moved emitted');

  await events.emitAsync('payment.received', {
    tenantId: TENANT,
    orderId: paid.id,
    amount: 500,
    paymentMode: 'CASH',
  });
  record(
    'complete_payment_for_lab_order_inform_patient',
    `payment.received on PAID order ${paid.orderCode}`,
  );
  if (partial && partial.id !== paid.id) {
    await events.emitAsync('payment.received', {
      tenantId: TENANT,
      orderId: partial.id,
      amount: 100,
      paymentMode: 'CASH',
    });
    record(
      'partial_payment_for_lab_order_inform_patient',
      `payment.received on PARTIALLY_PAID order ${partial.orderCode}`,
    );
  } else {
    record(
      'partial_payment_for_lab_order_inform_patient',
      'SKIPPED: no PARTIALLY_PAID order owned by patient',
    );
  }

  // report published (+ maybe completed): needs a real orderItem on the patient's order
  const item = await prisma.withTenant(TENANT, (tx) =>
    tx.orderItem.findFirst({
      where: { tenantId: TENANT, order: { patientId }, deletedAt: null },
      select: { id: true },
    }),
  );
  if (item) {
    await events.emitAsync('lab-report.published', {
      tenantId: TENANT,
      branchId: obranch,
      reportId: 'test',
      orderItemId: item.id,
    });
    record(
      'lab_order_report_published_inform_patient',
      `lab-report.published emitted for orderItem ${item.id}`,
    );
    record(
      'lab_order_completed_inform_patient',
      'completion fires only if ALL reports on the order are PUBLISHED (checked by listener)',
    );
  } else {
    record(
      'lab_order_report_published_inform_patient',
      'SKIPPED: no orderItem found for patient order',
    );
  }

  // phlebotomist order-created variant: find a home-visit order with a phlebotomist
  const phlebOrder = await prisma.withTenant(TENANT, (tx) =>
    tx.orderDiagnostics.findFirst({
      where: {
        tenantId: TENANT,
        isHomeVisit: true,
        phlebotomistId: { not: null },
      },
      select: { orderId: true },
    }),
  );
  if (phlebOrder) {
    const po = await prisma.withTenant(TENANT, (tx) =>
      tx.order.findFirst({
        where: { id: phlebOrder.orderId, tenantId: TENANT },
        select: { id: true, orderCode: true, patientId: true, branchId: true },
      }),
    );
    if (po?.patientId) {
      await events.emitAsync('order.created', {
        tenantId: TENANT,
        branchId: po.branchId,
        orderId: po.id,
        patientId: po.patientId,
        orderCode: po.orderCode,
      });
      record(
        'lab_create_order_with_phlebotomist_inform_patient',
        `order.created emitted for home-visit order ${po.orderCode} (recipient = that order's patient)`,
      );
    }
  } else {
    record(
      'lab_create_order_with_phlebotomist_inform_patient',
      'SKIPPED: no home-visit order with phlebotomist in tenant',
    );
  }

  // sample error/repeat → referral panel (recipient = panel, not user inbox)
  const b2bOrder = await prisma.withTenant(TENANT, (tx) =>
    tx.order.findFirst({
      where: {
        tenantId: TENANT,
        deletedAt: null,
        referralPanelId: { not: null },
      },
      select: { id: true },
    }),
  );
  if (b2bOrder) {
    await events.emitAsync('accession.sample.error', {
      tenantId: TENANT,
      branchId: BRANCH,
      sampleId: 'test',
      orderId: b2bOrder.id,
    });
    await events.emitAsync('accession.sample.repeat', {
      tenantId: TENANT,
      branchId: BRANCH,
      sampleId: 'test',
      orderId: b2bOrder.id,
    });
    record(
      'lab_report_sample_error_inform_referring_panel',
      `accession.sample.error emitted for B2B order ${b2bOrder.id} (recipient=panel)`,
    );
    record(
      'lab_report_sample_repeat_inform_referring_panel',
      `accession.sample.repeat emitted (recipient=panel)`,
    );
  } else {
    record(
      'lab_report_sample_error_inform_referring_panel',
      'SKIPPED: no order with a referral panel',
    );
    record(
      'lab_report_sample_repeat_inform_referring_panel',
      'SKIPPED: no order with a referral panel',
    );
  }

  // appointment reminders (cron) — recipient resolves from the order/patient; emit via worker path not available,
  // so exercise the same dispatch the cron uses by emitting nothing — instead we rely on the worker. Mark for direct check.
  record(
    'appointment_reminder_inform_patient',
    'cron-only (AppointmentReminderWorkerService); not event-driven — see remarks',
  );
  record(
    'appointment_reminder_inform_doctor',
    'cron-only (AppointmentReminderWorkerService); not event-driven — see remarks',
  );

  // ── Business events (recipient = event payload → routed to inbox) ──
  const bizBase = {
    tenantId: TENANT,
    businessName: 'Production Test Three',
    email: INBOX_EMAIL,
    phone: INBOX_MOBILE,
  };
  await events.emitAsync('business.registration.completed', {
    ...bizBase,
    slug: 'production-test-three',
    adminName: 'Priya',
  });
  record(
    'business_registration_complete',
    'business.registration.completed emitted → inbox',
  );
  await events.emitAsync('business.details.updated', bizBase);
  record('business_details_update', 'business.details.updated emitted → inbox');
  await events.emitAsync('business.status.suspended', bizBase);
  record(
    'business_status_suspend',
    'business.status.suspended emitted → inbox',
  );
  await events.emitAsync('business.status.unsuspended', bizBase);
  record(
    'business_status_unsuspend',
    'business.status.unsuspended emitted → inbox',
  );

  // ── Staff in-app (no messaging template; creates Notification rows) ──
  await events.emitAsync('users.user.created', {
    personId: ACTOR,
    tenantId: TENANT,
    userCode: 'USR-00003',
  });
  await events.emitAsync('users.user.status.changed', {
    tenantId: TENANT,
    personId: ACTOR,
    status: 'ACTIVE',
  });
  await events.emitAsync('users.branch.assignment.updated', {
    tenantId: TENANT,
    personId: ACTOR,
    branchId: BRANCH,
  });
  record(
    'staff_in_app',
    'users.user.created/status.changed/branch.assignment.updated emitted (in-app only)',
  );

  // ── Manual Share & Inform (call the real share services; recipient = PATIENT → inbox) ──
  const shareResults: Record<string, unknown> = {};
  const runShare = async (key: string, fn: () => Promise<unknown>) => {
    try {
      shareResults[key] = await fn();
      record(key, 'share-all invoked OK');
    } catch (e) {
      shareResults[key] = { error: (e as Error).message };
      record(key, `share FAILED: ${(e as Error).message}`);
    }
  };
  await runShare('order_bill_as_attachment', () =>
    orders.shareBillAll(
      oid,
      TENANT,
      obranch,
      { recipientType: 'PATIENT' },
      ACTOR,
    ),
  );
  await runShare('lab_quotation_as_attachment', () =>
    orders.shareQuoteAll(
      oid,
      TENANT,
      obranch,
      { recipientType: 'PATIENT' },
      ACTOR,
    ),
  );
  await runShare('lab_create_appointment_inform_patient', () =>
    orders.shareAppointmentAll(oid, TENANT, obranch, {}, ACTOR),
  );
  await runShare('order_invoice_as_attachment', () =>
    orders.shareTrfAll(
      oid,
      TENANT,
      obranch,
      { recipientType: 'PATIENT' },
      ACTOR,
    ),
  );
  await runShare('console_lab_report_as_attachment', () =>
    labReports.shareAllForOrder(oid, TENANT, obranch, {}, ACTOR),
  );

  // ── Let the running server's worker drain the queue, then capture ──
  logger.log('Waiting 45s for the server queue worker to drain…');
  await sleep(45000);

  const logs = await prisma.withTenant(TENANT, (tx) =>
    tx.communicationLog.findMany({
      where: { tenantId: TENANT, createdAt: { gte: t0 } },
      orderBy: { createdAt: 'asc' },
    }),
  );
  const tplIds = [
    ...new Set(logs.map((l) => l.templateId).filter(Boolean) as string[]),
  ];
  const tpls = await prisma.withTenant(TENANT, (tx) =>
    tx.template.findMany({
      where: { id: { in: tplIds } },
      select: { id: true, displayTitle: true, feature: true, entityType: true },
    }),
  );
  const tplById = new Map(tpls.map((t) => [t.id, t]));

  const notifs = await prisma.withTenant(TENANT, (tx) =>
    tx.notification.findMany({
      where: { tenantId: TENANT, createdAt: { gte: t0 } },
      select: { id: true, verb: true, subject: true, body: true },
    }),
  );

  const captured = logs.map((l) => {
    const tpl = l.templateId ? tplById.get(l.templateId) : null;
    const marker = `[[TPL:${l.feature}:${l.channel}]]`;
    return {
      feature: l.feature,
      channel: l.channel,
      status: l.status,
      recipientType: l.recipientType,
      toAddress: l.toAddress,
      templateTitle: tpl?.displayTitle ?? null,
      templateFeature: tpl?.feature ?? null,
      isAmnTemplate: tpl?.entityType === 'AMN_TEST',
      markerMatched: (l.body ?? '').includes(marker),
      exchangeId: l.exchangeId,
      statusMessage: l.statusMessage,
    };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    tenant: TENANT,
    patientId,
    inbox: { email: INBOX_EMAIL, mobile: INBOX_MOBILE },
    steps,
    shareResults,
    notifications: notifs,
    communicationLogs: captured,
  };
  const outPath = join(__dirname, 'amn-results.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  logger.log(
    `Captured ${captured.length} communication_logs, ${notifs.length} notifications → ${outPath}`,
  );

  // Console summary by feature+channel
  for (const c of captured) {
    logger.log(
      `  ${c.feature} [${c.channel}] → "${c.templateTitle}" amn=${c.isAmnTemplate} marker=${c.markerMatched} status=${c.status} ${c.statusMessage ? '(' + c.statusMessage + ')' : ''}`,
    );
  }

  await app.close();
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
