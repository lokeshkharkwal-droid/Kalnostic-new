/**
 * One-off backfill: initialise the phlebotomist reservation counters
 * (`PhlebotomistSlot.bookedCount` + `PhlebotomistDayLoad.bookedCount`) from the
 * existing business truth in `OrderDiagnostics`, for future-dated slots.
 *
 * Idempotent — safe to re-run; it recomputes counters via
 * `SlotReservationService.reconcile()`. Run:
 *   pnpm -C kalnostics-new exec ts-node prisma/backfill-slot-counters.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SlotReservationService } from '../src/modules/phlebotomist-schedule/slot-reservation.service';
import {
  addDays,
  startOfUtcDay,
} from '../src/modules/phlebotomist-schedule/utils/schedule-time.util';
import { PhlebotomistScheduleStatus } from '@prisma/client';

/** Look-ahead horizon (days) — matches the availability window cap. */
const HORIZON_DAYS = 70;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const reservation = app.get(SlotReservationService);

  const from = startOfUtcDay(new Date());
  const to = addDays(from, HORIZON_DAYS);

  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let tenantCount = 0;
  let scheduleCount = 0;

  for (const tenant of tenants) {
    await prisma.withTenant(tenant.id, async (tx) => {
      const schedules = await tx.phlebotomistSchedule.findMany({
        where: { status: PhlebotomistScheduleStatus.ACTIVE, deletedAt: null },
        select: { branchId: true, phlebotomistId: true },
      });
      for (const s of schedules) {
        if (!s.branchId) continue;
        await reservation.reconcile(
          tenant.id,
          s.branchId,
          s.phlebotomistId,
          from,
          to,
          tx,
        );
        scheduleCount += 1;
      }
    });
    tenantCount += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `Backfill complete: reconciled ${scheduleCount} active schedule(s) across ${tenantCount} tenant(s) for ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}.`,
  );
  await app.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
