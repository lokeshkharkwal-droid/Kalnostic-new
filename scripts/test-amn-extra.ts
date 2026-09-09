/**
 * amn.csv follow-up: trigger the phlebotomist order-created variant + the
 * referral-panel sample error/repeat notifications (their DB preconditions are
 * set up + reverted around this run by the caller). Same faithful listener path
 * as the main driver. Appends to scripts/amn-results-extra.json.
 *
 * Run:  pnpm ts-node --transpile-only -r tsconfig-paths/register scripts/test-amn-extra.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

process.env.COMMUNICATION_WORKER_ENABLED = 'false';
const logger = new Logger('TestAmnExtra');
const TENANT = '92f6e838-3779-4a74-a823-c1a8e50e2248';
const BRANCH = 'c99cf11b-db4d-4da1-9474-4b90fca87546';
const PAID_ORDER = '7e8e3a45-be53-428e-b418-320fe1708916'; // ORD-00065 (now home-visit+phleb)
const B2B_ORDER = 'b8539ad5-a0c9-4058-bded-3ee13b7618f3'; // ORD-00047 (panel now reachable)
const PATIENT = '12b5d807-6ad4-462c-9145-c59047e7cdd9';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const events = app.get(EventEmitter2);
  const t0 = new Date();

  await events.emitAsync('order.created', {
    tenantId: TENANT,
    branchId: BRANCH,
    orderId: PAID_ORDER,
    patientId: PATIENT,
    orderCode: 'ORD-00065',
  });
  logger.log('order.created (phleb) emitted');
  await events.emitAsync('accession.sample.error', {
    tenantId: TENANT,
    branchId: BRANCH,
    sampleId: 'x',
    orderId: B2B_ORDER,
  });
  await events.emitAsync('accession.sample.repeat', {
    tenantId: TENANT,
    branchId: BRANCH,
    sampleId: 'x',
    orderId: B2B_ORDER,
  });
  logger.log('sample error/repeat emitted');

  await sleep(45000);

  const feats = [
    'lab_create_order_with_phlebotomist_inform_patient',
    'lab_report_sample_error_inform_referring_panel',
    'lab_report_sample_repeat_inform_referring_panel',
  ];
  const logs = await prisma.withTenant(TENANT, (tx) =>
    tx.communicationLog.findMany({
      where: {
        tenantId: TENANT,
        createdAt: { gte: t0 },
        feature: { in: feats },
      },
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
  const byId = new Map(tpls.map((t) => [t.id, t]));
  const captured = logs.map((l) => {
    const tpl = l.templateId ? byId.get(l.templateId) : null;
    return {
      feature: l.feature,
      channel: l.channel,
      status: l.status,
      toAddress: l.toAddress,
      templateTitle: tpl?.displayTitle ?? null,
      templateFeature: tpl?.feature ?? null,
      isAmn: tpl?.entityType === 'AMN_TEST',
      markerMatched: (l.body ?? '').includes(
        `[[TPL:${l.feature}:${l.channel}]]`,
      ),
      exchangeId: l.exchangeId,
      statusMessage: l.statusMessage,
    };
  });
  writeFileSync(
    join(__dirname, 'amn-results-extra.json'),
    JSON.stringify(captured, null, 2),
    'utf8',
  );
  for (const c of captured)
    logger.log(
      `  ${c.feature} [${c.channel}] → "${c.templateTitle}" amn=${c.isAmn} marker=${c.markerMatched} status=${c.status}`,
    );
  logger.log(`captured ${captured.length} rows`);
  await app.close();
}
main().catch((e) => {
  logger.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
