import {
  MessageType,
  MessagingChannel,
  MessagingLevel,
  PrismaClient,
  SiteAdminRole,
  WhatsappMessageType,
  WhatsappTemplateCategory,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  PROFILE_BRANCH_MATRIX,
  PROFILE_LABELS,
  PROFILE_REGISTRY,
} from '../src/modules/permissions/constants/profile-registry.constant';

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

async function main() {
  await seedSiteAdmin();
  await seedSystemRoles();
  await seedGlobalMessagingTemplates();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
