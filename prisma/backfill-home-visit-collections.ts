/**
 * One-off backfill: create the `HomeVisitCollection` record (Phlebotomist module's
 * Collection Schedule) for every existing confirmed (ORDER/APPOINTMENT) home-visit
 * order that predates the feature and has no collection yet.
 *
 * Idempotent — safe to re-run; `createForOrderInTx` skips orders that already have
 * a collection and any order that isn't a home visit with an assigned phlebotomist
 * and a collection time. Run:
 *   pnpm -C kalnostics-new exec ts-node prisma/backfill-home-visit-collections.ts
 */
import { NestFactory } from '@nestjs/core';
import { OrderStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PhlebotomistCollectionService } from '../src/modules/phlebotomist-collection/phlebotomist-collection.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const collections = app.get(PhlebotomistCollectionService);

  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let tenantCount = 0;
  let createdOrScanned = 0;

  for (const tenant of tenants) {
    await prisma.withTenant(tenant.id, async (tx) => {
      // Confirmed home-visit orders with an assigned phlebotomist that have no
      // collection row yet. `createForOrderInTx` re-checks the guards + idempotency.
      const orders = await tx.order.findMany({
        where: {
          tenantId: tenant.id,
          deletedAt: null,
          status: { in: [OrderStatus.ORDER, OrderStatus.APPOINTMENT] },
          homeVisitCollection: { is: null },
          diagnostics: {
            is: { isHomeVisit: true, phlebotomistId: { not: null } },
          },
        },
        select: { id: true, branchId: true, createdBy: true },
      });
      for (const order of orders) {
        await collections.createForOrderInTx(
          tx,
          tenant.id,
          order.branchId,
          order.createdBy,
          order.id,
        );
        createdOrScanned += 1;
      }
    });
    tenantCount += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `Backfill complete: processed ${createdOrScanned} home-visit order(s) across ${tenantCount} tenant(s).`,
  );
  await app.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
