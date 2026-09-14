/**
 * One-time, idempotent backfill: give every existing tenant an `exchangeTenantId`.
 *
 *   pnpm sync:tenant-exchange-id
 *
 * Order (single transaction):
 *   1. Seed the counter to GREATEST(counter, MAX(legacyTenantId), MAX(exchangeTenantId)).
 *   2. Migrated-missing (legacyTenantId set, exchangeTenantId NULL) -> mirror legacyTenantId.
 *   3. Native-missing (both NULL) -> allocate sequentially by createdAt.
 *
 * Safe to run repeatedly: only NULL rows are touched; existing ids never change;
 * the counter only ever rises. Only touches platform-level tables (no RLS).
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ExchangeTenantIdService } from '../src/modules/tenant/exchange-tenant-id.service';

async function main(): Promise<void> {
  const logger = new Logger('sync-tenant-exchange-id');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const exchangeIds = app.get(ExchangeTenantIdService);

  try {
    // Shares the exact logic behind POST /siteadmin/tenants/sync-exchange-ids.
    const summary = await exchangeIds.backfillAll();
    logger.log(
      `Seed floor=${summary.floor}; mirrored ${summary.migrated} migrated, ` +
        `allocated ${summary.native} native tenant id(s).`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
