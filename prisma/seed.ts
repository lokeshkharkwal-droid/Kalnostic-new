import {
  AdapterAction,
  MessageType,
  MessagingChannel,
  MessagingLevel,
  Prisma,
  PrismaClient,
  SiteAdminRole,
  SmsType,
  WhatsappMessageType,
  WhatsappTemplateCategory,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  PROFILE_BRANCH_MATRIX,
  PROFILE_LABELS,
  PROFILE_REGISTRY,
} from '../src/modules/permissions/constants/profile-registry.constant';
import { seedPrintTemplates } from './seed-print-templates';

const prisma = new PrismaClient();

/**
 * Seed the default platform SiteAdmin (SUPER_OWNER). Idempotent: skips if the
 * account already exists.
 */
async function seedSiteAdmin(): Promise<void> {
  const email = 'admin@kalnostics.com';
  const plainPassword = 'SuperSecret1';

  const existingAdmin = await prisma.siteAdminUser.findFirst({
    where: { email, deletedAt: null },
  });
  if (existingAdmin) {
    console.log(`SiteAdminUser with email ${email} already exists.`);
    return;
  }

  const passwordHash = await bcrypt.hash(plainPassword, 12);
  await prisma.siteAdminUser.create({
    data: {
      firstName: 'Super',
      lastName: 'Admin',
      email,
      passwordHash,
      role: SiteAdminRole.SUPER_OWNER,
      isActive: true,
    },
  });
  console.log(`Seeded default SiteAdminUser:`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${plainPassword}`);
}

/**
 * Seed the global system roles (tenant_id = NULL) from PROFILE_REGISTRY — the
 * single source of truth for the built-in roles every tenant shares. Idempotent
 * and safe to re-run: each key is matched (find-then-create/update), so no
 * duplicates are ever created. `name` and `allowedBranchTypes` are kept in sync
 * with the code constants (system-role names are immutable via the API);
 * `isActive` is left untouched on existing rows so an admin's toggle survives.
 */
async function seedSystemRoles(): Promise<void> {
  let created = 0;
  let updated = 0;
  for (const key of PROFILE_REGISTRY) {
    const name = PROFILE_LABELS[key];
    const allowedBranchTypes = PROFILE_BRANCH_MATRIX[key] ?? [];
    const existing = await prisma.authRole.findFirst({
      where: { key, tenantId: null },
    });
    if (existing) {
      await prisma.authRole.update({
        where: { id: existing.id },
        data: { name, allowedBranchTypes, isSystem: true, deletedAt: null },
      });
      updated += 1;
    } else {
      await prisma.authRole.create({
        data: {
          tenantId: null,
          key,
          name,
          allowedBranchTypes,
          isSystem: true,
          isActive: true,
        },
      });
      created += 1;
    }
  }
  console.log(
    `Seeded system roles: ${created} created, ${updated} updated ` +
      `(${PROFILE_REGISTRY.length} total).`,
  );
}

/**
 * Seed a starter set of SITE_ADMIN global messaging templates (tenant_id NULL)
 * so the business "Old Templates" SMS/Email/WhatsApp/Bulk screens have something
 * to enable. These are the platform-provided defaults a business imports
 * (clone-on-enable). Idempotent: a template with the same (preference, feature)
 * among active globals is skipped, so re-running never duplicates. `feature`
 * values are drawn from the FEATURE_TYPES catalogue.
 */
async function seedGlobalMessagingTemplates(): Promise<void> {
  interface Seed {
    preference: MessagingChannel;
    feature: string;
    displayTitle: string;
    template: string;
    messageType?: MessageType;
    templateType?: WhatsappMessageType;
    templateCategory?: WhatsappTemplateCategory;
  }

  const seeds: Seed[] = [
    // ── SMS ──
    {
      preference: MessagingChannel.SMS,
      feature: 'patient_registration',
      displayTitle: 'Patient Registration',
      template:
        'Dear {patient_name}, welcome to {branch_name}. Your registration is complete.',
      messageType: MessageType.TRANSACTIONAL,
    },
    {
      preference: MessagingChannel.SMS,
      feature: 'lab_order_report_published_inform_patient',
      displayTitle: 'Lab Report Published',
      template:
        'Dear {patient_name}, your report for order {order_id} is ready: {report_link}',
      messageType: MessageType.TRANSACTIONAL,
    },
    {
      preference: MessagingChannel.SMS,
      feature: 'appointment_reminder_inform_patient',
      displayTitle: 'Appointment Reminder',
      template:
        'Reminder: {patient_name}, your appointment at {branch_name} is on {appointment_date}.',
      messageType: MessageType.TRANSACTIONAL,
    },
    {
      preference: MessagingChannel.SMS,
      feature: 'patient_pay_request_for_order',
      displayTitle: 'Payment Request',
      template:
        'Dear {patient_name}, an amount of {amount} is due for order {order_id}. Pay: {report_link}',
      messageType: MessageType.TRANSACTIONAL,
    },
    // ── Email ──
    {
      preference: MessagingChannel.EMAIL,
      feature: 'patient_registration',
      displayTitle: 'Patient Registration',
      template:
        '<p>Dear {patient_name},</p><p>Welcome to <strong>{branch_name}</strong>. Your registration is complete.</p>',
      messageType: MessageType.TRANSACTIONAL,
    },
    {
      preference: MessagingChannel.EMAIL,
      feature: 'lab_order_report_published_inform_patient',
      displayTitle: 'Lab Report Published',
      template:
        '<p>Dear {patient_name},</p><p>Your report for order <strong>{order_id}</strong> is ready. <a href="{report_link}">View report</a>.</p>',
      messageType: MessageType.TRANSACTIONAL,
    },
    {
      preference: MessagingChannel.EMAIL,
      feature: 'complete_payment_for_lab_order_inform_patient',
      displayTitle: 'Payment Received',
      template:
        '<p>Dear {patient_name},</p><p>We have received your payment of <strong>{amount}</strong> for order {order_id}. Thank you.</p>',
      messageType: MessageType.TRANSACTIONAL,
    },
    // ── WhatsApp ──
    {
      preference: MessagingChannel.WHATSAPP,
      feature: 'lab_order_report_published_inform_patient',
      displayTitle: 'Lab Report Published',
      template:
        'Dear {patient_name}, your report for order {order_id} is ready: {report_link}',
      templateType: WhatsappMessageType.TEXT,
      templateCategory: WhatsappTemplateCategory.UTILITY,
    },
    {
      preference: MessagingChannel.WHATSAPP,
      feature: 'appointment_reminder_inform_patient',
      displayTitle: 'Appointment Reminder',
      template:
        'Reminder: {patient_name}, your appointment at {branch_name} is on {appointment_date}.',
      templateType: WhatsappMessageType.TEXT,
      templateCategory: WhatsappTemplateCategory.UTILITY,
    },
    // ── Site Admin business lifecycle ──
    // Business Registration Complete → Email / SMS / WhatsApp.
    {
      preference: MessagingChannel.EMAIL,
      feature: 'business_registration_complete',
      displayTitle: 'Business Registration Complete',
      template:
        '<p>Dear {business_name},</p><p>Your business has been registered successfully. You can now sign in and start setting up your lab.</p><p>Thank you.</p>',
      messageType: MessageType.TRANSACTIONAL,
    },
    {
      preference: MessagingChannel.SMS,
      feature: 'business_registration_complete',
      displayTitle: 'Business Registration Complete',
      template:
        'Welcome {business_name}! Your business registration is complete. You can now sign in and set up your lab.',
      messageType: MessageType.TRANSACTIONAL,
    },
    {
      preference: MessagingChannel.WHATSAPP,
      feature: 'business_registration_complete',
      displayTitle: 'Business Registration Complete',
      template:
        'Welcome {business_name}! Your business registration is complete. You can now sign in and set up your lab.',
      messageType: MessageType.TRANSACTIONAL,
      templateType: WhatsappMessageType.TEXT,
      templateCategory: WhatsappTemplateCategory.UTILITY,
    },
    // Business Details Updated → Email / SMS.
    {
      preference: MessagingChannel.EMAIL,
      feature: 'business_details_update',
      displayTitle: 'Business Details Updated',
      template:
        '<p>Dear {business_name},</p><p>Your business profile details have been updated. If you did not request this change, please contact support.</p>',
      messageType: MessageType.TRANSACTIONAL,
    },
    {
      preference: MessagingChannel.SMS,
      feature: 'business_details_update',
      displayTitle: 'Business Details Updated',
      template:
        'Dear {business_name}, your business profile details have been updated. If this was not you, please contact support.',
      messageType: MessageType.TRANSACTIONAL,
    },
    // Business Status Suspended → Email / SMS.
    {
      preference: MessagingChannel.EMAIL,
      feature: 'business_status_suspend',
      displayTitle: 'Business Status — Suspended',
      template:
        '<p>Dear {business_name},</p><p>Access to your business account has been suspended. Please contact support for assistance.</p>',
      messageType: MessageType.TRANSACTIONAL,
    },
    {
      preference: MessagingChannel.SMS,
      feature: 'business_status_suspend',
      displayTitle: 'Business Status — Suspended',
      template:
        'Dear {business_name}, access to your business account has been suspended. Please contact support for assistance.',
      messageType: MessageType.TRANSACTIONAL,
    },
    // Business Status Unsuspended → Email / SMS.
    {
      preference: MessagingChannel.EMAIL,
      feature: 'business_status_unsuspend',
      displayTitle: 'Business Status — Unsuspended',
      template:
        '<p>Dear {business_name},</p><p>Access to your business account has been reinstated. You can sign in again as usual.</p><p>Thank you.</p>',
      messageType: MessageType.TRANSACTIONAL,
    },
    {
      preference: MessagingChannel.SMS,
      feature: 'business_status_unsuspend',
      displayTitle: 'Business Status — Unsuspended',
      template:
        'Dear {business_name}, access to your business account has been reinstated. You can sign in again as usual.',
      messageType: MessageType.TRANSACTIONAL,
    },
    // ── Bulk (MARKETING) ──
    {
      preference: MessagingChannel.SMS,
      feature: 'bulk_messaging',
      displayTitle: 'Bulk Promotion (SMS)',
      template:
        'Hi {patient_name}! {branch_name} has a special health check-up offer for you.',
      messageType: MessageType.MARKETING,
    },
    {
      preference: MessagingChannel.EMAIL,
      feature: 'bulk_messaging',
      displayTitle: 'Bulk Promotion (Email)',
      template:
        '<p>Hi {patient_name}!</p><p>{branch_name} has a special health check-up offer for you.</p>',
      messageType: MessageType.MARKETING,
    },
    {
      preference: MessagingChannel.WHATSAPP,
      feature: 'google_review_template',
      displayTitle: 'Google Review Request',
      template:
        'Hi {patient_name}, we hope you had a great experience at {branch_name}. Please review us: {report_link}',
      messageType: MessageType.MARKETING,
      templateType: WhatsappMessageType.TEXT,
      templateCategory: WhatsappTemplateCategory.MARKETING,
    },
  ];

  let created = 0;
  for (const s of seeds) {
    const existing = await prisma.template.findFirst({
      where: {
        tenantId: null,
        preference: s.preference,
        feature: s.feature,
        messageType: s.messageType ?? null,
        deletedAt: null,
      },
    });
    if (existing) continue;
    await prisma.template.create({
      data: {
        tenantId: null,
        branchId: null,
        preference: s.preference,
        feature: s.feature,
        displayTitle: s.displayTitle,
        template: s.template,
        messageType: s.messageType ?? null,
        templateType: s.templateType ?? null,
        templateCategory: s.templateCategory ?? null,
        level: MessagingLevel.ADMIN,
        isActive: true,
      },
    });
    created += 1;
  }
  console.log(
    `Seeded global messaging templates: ${created} created ` +
      `(${seeds.length} in the starter set).`,
  );
}

/**
 * Seed the SITE_ADMIN global messaging templates for the "Share and Inform" flows
 * (Billings / Quotations / Appointments), so a tenant can enable + activate them
 * under Templates and the share endpoints resolve a template per channel:
 *  - `order_bill_as_attachment`            — EMAIL, WHATSAPP, IAM
 *  - `lab_quotation_as_attachment`         — EMAIL, WHATSAPP, IAM
 *  - `lab_create_appointment_inform_patient` — SMS, EMAIL, WHATSAPP, IAM
 * SMS/WhatsApp carry placeholder DLT/approved-template ids so the cloned copy
 * passes the carrier-settings check (the dev Exchange gateway is a no-op). IAM
 * globals have no channel tab in the enable UI yet — activate them another way.
 * Idempotent: matched on (tenant-null, preference, feature).
 */
async function seedShareTemplates(): Promise<void> {
  interface Seed {
    preference: MessagingChannel;
    feature: string;
    displayTitle: string;
    template: string;
    smsTemplateId?: string;
    smsSenderId?: string;
    smsType?: SmsType;
    templateType?: WhatsappMessageType;
    templateCategory?: WhatsappTemplateCategory;
  }

  // Shared carrier placeholders (dev): make the carrier-settings validation pass.
  const WA = {
    smsTemplateId: 'wa_test_template_id',
    templateType: WhatsappMessageType.TEXT,
    templateCategory: WhatsappTemplateCategory.UTILITY,
  };
  const SMS = {
    smsTemplateId: 'DLT_TEST_TEMPLATE_ID',
    smsSenderId: 'KALNOS',
    smsType: SmsType.TRANSACTIONAL,
  };

  const seeds: Seed[] = [
    // ── Order Bill (Billings + Finance Billing) ──
    {
      preference: MessagingChannel.EMAIL,
      feature: 'order_bill_as_attachment',
      displayTitle: 'Order Bill (Email)',
      template:
        'Dear {patient_name}, please find your bill {bill_id} for order {order_code} attached.',
    },
    {
      preference: MessagingChannel.WHATSAPP,
      feature: 'order_bill_as_attachment',
      displayTitle: 'Order Bill (WhatsApp)',
      template:
        'Hi {patient_name}, your bill {bill_id} for order {order_code} is attached.',
      ...WA,
    },
    {
      preference: MessagingChannel.IAM,
      feature: 'order_bill_as_attachment',
      displayTitle: 'Order Bill (In-App)',
      template:
        'Bill {bill_id} shared for order {order_code} ({patient_name}).',
    },
    // ── Lab Quotation (Quotations) ──
    {
      preference: MessagingChannel.EMAIL,
      feature: 'lab_quotation_as_attachment',
      displayTitle: 'Lab Quotation (Email)',
      template:
        'Dear {patient_name}, please find your quotation {quote_id} attached.',
    },
    {
      preference: MessagingChannel.WHATSAPP,
      feature: 'lab_quotation_as_attachment',
      displayTitle: 'Lab Quotation (WhatsApp)',
      template: 'Hi {patient_name}, your quotation {quote_id} is attached.',
      ...WA,
    },
    {
      preference: MessagingChannel.IAM,
      feature: 'lab_quotation_as_attachment',
      displayTitle: 'Lab Quotation (In-App)',
      template: 'Quotation {quote_id} shared ({patient_name}).',
    },
    // ── Appointment confirmation (Appointments) ──
    {
      preference: MessagingChannel.SMS,
      feature: 'lab_create_appointment_inform_patient',
      displayTitle: 'Appointment Confirmation (SMS)',
      template:
        'Dear {patient_name}, your appointment {appointment_code} is confirmed.',
      ...SMS,
    },
    {
      preference: MessagingChannel.EMAIL,
      feature: 'lab_create_appointment_inform_patient',
      displayTitle: 'Appointment Confirmation (Email)',
      template:
        'Dear {patient_name}, your appointment {appointment_code} is confirmed.',
    },
    {
      preference: MessagingChannel.WHATSAPP,
      feature: 'lab_create_appointment_inform_patient',
      displayTitle: 'Appointment Confirmation (WhatsApp)',
      template:
        'Hi {patient_name}, your appointment {appointment_code} is confirmed.',
      ...WA,
    },
    {
      preference: MessagingChannel.IAM,
      feature: 'lab_create_appointment_inform_patient',
      displayTitle: 'Appointment (In-App)',
      template: 'Appointment {appointment_code} shared ({patient_name}).',
    },
  ];

  let created = 0;
  for (const s of seeds) {
    const existing = await prisma.template.findFirst({
      where: {
        tenantId: null,
        preference: s.preference,
        feature: s.feature,
        deletedAt: null,
      },
    });
    if (existing) continue;
    await prisma.template.create({
      data: {
        tenantId: null,
        branchId: null,
        preference: s.preference,
        feature: s.feature,
        displayTitle: s.displayTitle,
        template: s.template,
        messageType: MessageType.TRANSACTIONAL,
        smsTemplateId: s.smsTemplateId ?? null,
        smsSenderId: s.smsSenderId ?? null,
        smsType: s.smsType ?? null,
        templateType: s.templateType ?? null,
        templateCategory: s.templateCategory ?? null,
        level: MessagingLevel.ADMIN,
        isActive: true,
      },
    });
    created += 1;
  }
  console.log(
    `Seeded Share & Inform global templates: ${created} created ` +
      `(${seeds.length} in the set).`,
  );
}

/**
 * Seed demo EMI adapter-log rows so the Adapter Logs screens (Site Admin,
 * Business Admin, Branch Admin) render real data. Idempotent per tenant: skips
 * any tenant that already has adapter logs.
 *
 * `adapter_logs` has FORCE ROW LEVEL SECURITY (prisma/rls.sql), so each insert
 * runs inside a transaction with the `app.current_tenant_id` GUC set — mirroring
 * `PrismaService.withTenant`. Attaches logs to the tenant's branches (and one
 * tenant-level row with `branchId = null`) so the branch-scoped view has data.
 * If no tenants exist yet, logs and skips.
 */
async function seedAdapterLogs(): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    take: 3,
  });

  if (tenants.length === 0) {
    console.log('  ↳ no tenants found — skipping adapter-log seed');
    return;
  }

  /** Build a small, varied set of adapter-log rows for one tenant. */
  const buildRows = (
    tenantId: string,
    branchIds: (string | null)[],
  ): Prisma.AdapterLogCreateManyInput[] => {
    const pick = (i: number) => branchIds[i % branchIds.length] ?? null;
    const now = Date.now();
    const at = (minsAgo: number) => new Date(now - minsAgo * 60_000);

    return [
      {
        tenantId,
        branchId: pick(0),
        token: 'TKN-9F2A7C',
        action: AdapterAction.ORDERS,
        status: 'SUCCESS',
        statusCode: 200,
        sourceIpAddress: '203.0.113.24',
        request: JSON.stringify({ specimen_id: 'ORD-100245' }, null, 2),
        response: JSON.stringify(
          { specimen_id: 'ORD-100245', tests: ['CBC', 'LFT'], status: 'ok' },
          null,
          2,
        ),
        createdAt: at(6),
      },
      {
        tenantId,
        branchId: pick(1),
        token: 'TKN-4B81E0',
        action: AdapterAction.SUBMIT_RESULT,
        status: 'SUCCESS',
        statusCode: 200,
        sourceIpAddress: '203.0.113.24',
        request: JSON.stringify(
          {
            specimen_id: 'ORD-100245',
            test_results: [{ code: 'HGB', value: '13.4', unit: 'g/dL' }],
          },
          null,
          2,
        ),
        response: JSON.stringify(
          { emi_status: '1', message: 'accepted' },
          null,
          2,
        ),
        createdAt: at(4),
      },
      {
        tenantId,
        branchId: pick(2),
        token: 'TKN-77C1AA',
        action: AdapterAction.SUBMIT_RESULT,
        status: 'FAILED',
        statusCode: 422,
        sourceIpAddress: '198.51.100.10',
        request: JSON.stringify(
          { specimen_id: 'ORD-999999', test_results: [] },
          null,
          2,
        ),
        response: JSON.stringify(
          {
            emi_status: '0',
            update_test_status: '0',
            error: 'order not found',
          },
          null,
          2,
        ),
        createdAt: at(3),
      },
      {
        tenantId,
        branchId: null, // tenant-level row (visible to business admin, not branch)
        token: 'TKN-12FE90',
        action: AdapterAction.ORDERS,
        status: 'FAILED',
        statusCode: 500,
        sourceIpAddress: '192.0.2.55',
        request: JSON.stringify({ specimen_id: 'ORD-100301' }, null, 2),
        response: JSON.stringify({ error: 'adapter timeout' }, null, 2),
        createdAt: at(1),
      },
    ];
  };

  for (const tenant of tenants) {
    // Count is scoped explicitly by tenantId (not via the RLS GUC) so it stays
    // correct even when the seed connects as a superuser that bypasses RLS.
    const existing = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
      return tx.adapterLog.count({ where: { tenantId: tenant.id } });
    });
    if (existing > 0) {
      console.log(
        `  ↳ ${tenant.name}: ${existing} adapter log(s) already present — skipping`,
      );
      continue;
    }

    const branches = await prisma.branch.findMany({
      where: { tenantId: tenant.id, deletedAt: null },
      select: { id: true },
      take: 3,
    });
    const branchIds: (string | null)[] =
      branches.length > 0 ? branches.map((b) => b.id) : [null];

    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
      const { count } = await tx.adapterLog.createMany({
        data: buildRows(tenant.id, branchIds),
      });
      return count;
    });
    console.log(`  ↳ ${tenant.name}: seeded ${created} adapter log(s)`);
  }
}

async function main() {
  await seedSiteAdmin();
  await seedSystemRoles();
  await seedGlobalMessagingTemplates();
  await seedShareTemplates();
  await seedPrintTemplates(prisma);
  await seedAdapterLogs();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
