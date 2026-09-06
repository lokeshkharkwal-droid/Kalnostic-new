/**
 * Seed the messaging templates named in `amn.csv` into ONE tenant, so the
 * notification template-selection tests have an exact, uniquely-identifiable
 * template per (feature × channel). REUSES the real `TemplateService.create`
 * (RLS tenant context + validation), never a raw Prisma insert.
 *
 * Every seeded template:
 *   - is tenant-level (branchId = null) so it applies to every branch and beats
 *     the SITE_ADMIN globals in the resolveForDelivery/resolveActivatedTemplate
 *     cascade (branch → tenant → global);
 *   - is isActive + isDefault so it deterministically wins over any pre-existing
 *     tenant row for the same (feature, channel);
 *   - carries a unique body marker `[[TPL:<feature>:<CHANNEL>]]` so the rendered
 *     `communication_logs.body` proves exactly which template was selected;
 *   - is tagged `entityType = 'AMN_TEST'` so a re-run can soft-delete the prior
 *     batch first (idempotent).
 *
 * It also seeds a DECOY: a second EMAIL template for lab_create_order_inform_patient
 * with isDefault=false, to prove live that isDefault wins the tie.
 *
 * Run:  pnpm ts-node --transpile-only -r tsconfig-paths/register scripts/seed-amn-templates.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import {
  MessagingChannel,
  MessageType,
  SmsType,
  WhatsappMessageType,
  WhatsappTemplateCategory,
} from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TemplateService } from '../src/modules/template/template.service';
import type { CreateTemplateDto } from '../src/modules/template/dto/create-template.dto';

// Never let this process's queue worker drain (the running server does that).
process.env.COMMUNICATION_WORKER_ENABLED = 'false';

const logger = new Logger('SeedAmnTemplates');

const TENANT_ID = '92f6e838-3779-4a74-a823-c1a8e50e2248'; // production test three
const ACTOR_ID = '51f3772e-f548-4f14-a8c7-18d9b57e6070'; // priya (person id)
const TAG = 'AMN_TEST';

type Ch = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'IAM';

/** One CSV row → the template name + feature + the channels to seed for it. */
interface Row {
  name: string;
  feature: string;
  channels: Ch[];
}

// ── Automatic table (rows that use a messaging template; the 3 in-app-only
//    staff rows have no template, so they are omitted here) ──
const AUTOMATIC: Row[] = [
  {
    name: 'Order Created - Inform Patient',
    feature: 'lab_create_order_inform_patient',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Lab Create Order with Phlebotomist - Inform Patient',
    feature: 'lab_create_order_with_phlebotomist_inform_patient',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Lab Order Report Published - Inform Patient',
    feature: 'lab_order_report_published_inform_patient',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Lab Order Completed - Inform Patient',
    feature: 'lab_order_completed_inform_patient',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Complete Payment for Order - Inform Patient',
    feature: 'complete_payment_for_lab_order_inform_patient',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Partial Payment for Order - Inform Patient',
    feature: 'partial_payment_for_lab_order_inform_patient',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Order Cancelled - Inform Patient',
    feature: 'order_cancelled_inform_patient',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Lab Order Report Refund - Inform Patient',
    feature: 'lab_order_report_refund_inform_patient',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Patient Profile Update - Inform Patient',
    feature: 'patient_profile_update',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Lab Move Appointment - Inform Patient',
    feature: 'lab_move_appointment',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Appointment Reminder - Inform Patient',
    feature: 'appointment_reminder_inform_patient',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Appointment Reminder - Inform Doctor',
    feature: 'appointment_reminder_inform_doctor',
    channels: ['EMAIL', 'SMS', 'WHATSAPP'],
  },
  {
    name: 'Lab Report Sample Error - Inform Referring Panel',
    feature: 'lab_report_sample_error_inform_referring_panel',
    channels: ['EMAIL', 'SMS', 'WHATSAPP'],
  },
  {
    name: 'Lab Report Sample Repeat - Inform Referring Panel',
    feature: 'lab_report_sample_repeat_inform_referring_panel',
    channels: ['EMAIL', 'SMS', 'WHATSAPP'],
  },
  {
    name: 'Business Registration Complete',
    feature: 'business_registration_complete',
    channels: ['EMAIL', 'SMS', 'WHATSAPP'],
  },
  {
    name: 'Business Details Updated',
    feature: 'business_details_update',
    channels: ['EMAIL', 'SMS'],
  },
  {
    name: 'Business Status Suspended',
    feature: 'business_status_suspend',
    channels: ['EMAIL', 'SMS'],
  },
  {
    name: 'Business Status Unsuspended',
    feature: 'business_status_unsuspend',
    channels: ['EMAIL', 'SMS'],
  },
];

// ── Manual (Share & Inform) table ──
const MANUAL: Row[] = [
  {
    name: 'Console - Lab Report as Attachment',
    feature: 'console_lab_report_as_attachment',
    channels: ['EMAIL', 'SMS', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Order Bill as Attachment',
    feature: 'order_bill_as_attachment',
    channels: ['EMAIL', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Lab Quotation as Attachment',
    feature: 'lab_quotation_as_attachment',
    channels: ['EMAIL', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'Lab Create Appointment - Inform Patient',
    feature: 'lab_create_appointment_inform_patient',
    channels: ['SMS', 'EMAIL', 'WHATSAPP', 'IAM'],
  },
  {
    name: 'order invoice as attachment',
    feature: 'order_invoice_as_attachment',
    channels: ['EMAIL', 'WHATSAPP', 'IAM'],
  },
];

/** Build the body for a (feature, channel) with the unique marker + placeholders. */
function buildBody(feature: string, ch: Ch, name: string): string {
  const marker = `[[TPL:${feature}:${ch}]]`;
  const line = `${name}: order {order_code} ({order_number}), amount {amount} {currency}, at {aptTimeFmt}. Hi {patient_name}.`;
  if (ch === 'EMAIL') {
    return `<div><p>${marker}</p><p>${line}</p></div>`;
  }
  return `${marker} ${line}`;
}

function toDto(
  feature: string,
  ch: Ch,
  name: string,
  isDefault: boolean,
): CreateTemplateDto {
  const dto: CreateTemplateDto = {
    preference: MessagingChannel[ch],
    feature,
    displayTitle: name,
    template: buildBody(feature, ch, name),
    messageType: MessageType.TRANSACTIONAL,
    isActive: true,
    isDefault,
    isEnabled: true,
    entityType: TAG,
  };
  if (ch === 'SMS') {
    dto.smsTemplateId = `AMN_DLT_${feature}`.slice(0, 60);
    dto.smsSenderId = 'AMNTST';
    dto.smsType = SmsType.TRANSACTIONAL;
  } else if (ch === 'WHATSAPP') {
    dto.smsTemplateId = `AMN_WA_${feature}`.slice(0, 60);
    dto.smsSenderId = 'AMNTST';
    dto.templateType = WhatsappMessageType.TEXT;
    dto.templateCategory = WhatsappTemplateCategory.UTILITY;
  }
  return dto;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const templates = app.get(TemplateService);

  // 1. Idempotency: soft-delete any prior AMN_TEST batch in this tenant.
  const purged = await prisma.withTenant(TENANT_ID, (tx) =>
    tx.template.updateMany({
      where: { tenantId: TENANT_ID, entityType: TAG, deletedAt: null },
      data: { deletedAt: new Date() },
    }),
  );
  logger.log(`Purged ${purged.count} prior AMN_TEST templates.`);

  // 2. Seed every row × channel (tenant-level, branchId = null).
  const rows = [...AUTOMATIC, ...MANUAL];
  let created = 0;
  const summary: Record<string, string[]> = {};
  for (const row of rows) {
    for (const ch of row.channels) {
      await templates.create(
        TENANT_ID,
        null,
        toDto(row.feature, ch, row.name, true),
        ACTOR_ID,
      );
      created++;
      (summary[row.feature] ??= []).push(ch);
    }
  }

  // 3. DECOY: a 2nd EMAIL template for lab_create_order_inform_patient,
  //    isDefault=false + distinct marker — to prove isDefault wins live.
  const decoy = toDto(
    'lab_create_order_inform_patient',
    'EMAIL',
    'DECOY Order Created (non-default)',
    false,
  );
  decoy.template = `<div><p>[[TPL-DECOY:lab_create_order_inform_patient:EMAIL:NONDEFAULT]]</p></div>`;
  await templates.create(TENANT_ID, null, decoy, ACTOR_ID);
  created++;

  logger.log(
    `Created ${created} AMN_TEST templates across ${rows.length} features.`,
  );
  for (const [feature, chans] of Object.entries(summary)) {
    logger.log(`  ${feature}: ${chans.join(', ')}`);
  }

  await app.close();
  logger.log('Done.');
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
