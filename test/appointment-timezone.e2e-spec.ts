import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env into process.env before the Prisma client is constructed (mirrors
// slot-reservation.e2e-spec.ts). The suite self-skips if the DB is unreachable.
try {
  const env = readFileSync(join(process.cwd(), '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const match = /^\s*([\w.]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = (match[2] ?? '').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  /* .env is optional */
}

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PhleboServiceType,
  PhlebotomistScheduleStatus,
  Prisma,
  RecurrencePattern,
  SlotStatus,
} from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { SlotReservationService } from './../src/modules/phlebotomist-schedule/slot-reservation.service';
import { TenantTimeZoneService } from './../src/modules/tenant/tenant-timezone.service';

/**
 * Proves the appointment/collection timezone contract end-to-end: a booking is
 * stored as a true UTC instant, and the slot matcher projects it to the tenant's
 * business-local wall clock (via `TenantTimeZoneService` + `toBranchLocalInstant`)
 * before matching the locally-authored slot window.
 *
 * With the tenant forced to `Asia/Kolkata` (UTC+5:30) and a slot authored at local
 * 14:00–15:00:
 *   • a booking at 09:00Z (= 14:30 IST) must RESERVE (inside the window), and
 *   • a booking at 08:00Z (= 13:30 IST) must be REJECTED (outside the window).
 * Under the old "naive UTC = wall clock" logic, 09:00Z would read as 09:00 and
 * FAIL — so a successful 09:00Z reservation is the proof the conversion is applied.
 *
 * Requires a reachable PostgreSQL. The tenant's `settings` are snapshotted and
 * restored in afterAll, so the dev DB is left exactly as found.
 */
describe('Appointment timezone slot matching (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reservation: SlotReservationService;
  let tenantTz: TenantTimeZoneService;

  let tenantId: string;
  let branchId: string;
  let phleb: string;
  let originalSettings: Prisma.JsonValue = null;
  let ready = false;

  // A comfortably-future day so bookings are never in the past.
  const base = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  const slotDate = new Date(Date.UTC(y, m, d));
  // 09:00Z == 14:30 IST (inside 14:00–15:00); 08:00Z == 13:30 IST (outside).
  const insideAt = new Date(Date.UTC(y, m, d, 9, 0, 0));
  const outsideAt = new Date(Date.UTC(y, m, d, 8, 0, 0));

  async function seed(): Promise<void> {
    await prisma.withTenant(tenantId, async (tx) => {
      const schedule = await tx.phlebotomistSchedule.create({
        data: {
          tenantId,
          branchId,
          phlebotomistId: phleb,
          serviceType: PhleboServiceType.HOME_COLLECTION,
          status: PhlebotomistScheduleStatus.ACTIVE,
          startTime: '14:00',
          endTime: '15:00',
          intervalMinutes: 60,
          travelBufferMinutes: 0,
          maxVisitsPerDay: 0,
          slotCapacity: 2,
          recurrencePattern: RecurrencePattern.WEEKLY,
        },
        select: { id: true },
      });
      await tx.phlebotomistSlot.create({
        data: {
          tenantId,
          branchId,
          phlebotomistId: phleb,
          scheduleId: schedule.id,
          slotDate,
          startTime: '14:00',
          endTime: '15:00',
          slotCapacity: 2,
          bookedCount: 0,
          status: SlotStatus.AVAILABLE,
        },
      });
    });
  }

  async function cleanup(): Promise<void> {
    await prisma.withTenant(tenantId, async (tx) => {
      await tx.phlebotomistSlot.deleteMany({
        where: { tenantId, phlebotomistId: phleb, slotDate },
      });
      await tx.phlebotomistDayLoad.deleteMany({
        where: { tenantId, phlebotomistId: phleb, loadDate: slotDate },
      });
      await tx.phlebotomistSchedule.deleteMany({
        where: { tenantId, phlebotomistId: phleb, branchId },
      });
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    reservation = app.get(SlotReservationService);
    tenantTz = app.get(TenantTimeZoneService);

    const branch = await prisma.branch.findFirst({
      where: { deletedAt: null },
      select: { id: true, tenantId: true },
    });
    const person = await prisma.person.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });
    if (!branch || !person) return;
    tenantId = branch.tenantId;
    branchId = branch.id;
    phleb = person.id;

    // Force the tenant zone to IST for the duration (restored in afterAll).
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    originalSettings = tenant?.settings ?? null;
    const merged = {
      ...((originalSettings as Record<string, unknown> | null) ?? {}),
      timezone: 'Asia/Kolkata',
    };
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: merged },
    });

    await cleanup();
    await seed();
    ready = true;
  }, 60000);

  afterAll(async () => {
    if (ready) {
      await cleanup();
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          settings:
            originalSettings === null
              ? Prisma.JsonNull
              : (originalSettings as Prisma.InputJsonValue),
        },
      });
    }
    await app?.close();
  });

  it('has fixtures to run against (skips otherwise)', () => {
    if (!ready) {
      console.warn('SKIP: needs a tenant + branch + person in the database.');
    }
    expect(true).toBe(true);
  });

  it('resolves the tenant zone as Asia/Kolkata', async () => {
    if (!ready) return;
    expect(await tenantTz.getTimeZone(tenantId)).toBe('Asia/Kolkata');
  });

  it('reserves a 09:00Z booking against a 14:00–15:00 local slot (= 14:30 IST)', async () => {
    if (!ready) return;
    await prisma.withTenant(tenantId, (tx) =>
      reservation.reserveInTx(tx, tenantId, branchId, phleb, insideAt),
    );
    const slot = await prisma.phlebotomistSlot.findFirst({
      where: { tenantId, phlebotomistId: phleb, slotDate },
      select: { bookedCount: true },
    });
    expect(slot?.bookedCount).toBe(1);
  }, 60000);

  it('rejects an 08:00Z booking (= 13:30 IST, outside the 14:00–15:00 window)', async () => {
    if (!ready) return;
    await expect(
      prisma.withTenant(tenantId, (tx) =>
        reservation.reserveInTx(tx, tenantId, branchId, phleb, outsideAt),
      ),
    ).rejects.toBeDefined();
    // The failed booking must not have touched the counter.
    const slot = await prisma.phlebotomistSlot.findFirst({
      where: { tenantId, phlebotomistId: phleb, slotDate },
      select: { bookedCount: true },
    });
    expect(slot?.bookedCount).toBe(1);
  }, 60000);

  it('migration SQL converts a naive-local-Z instant to true UTC (14:30Z @ IST -> 09:00Z)', async () => {
    if (!ready) return;
    // Exactly the expression the data migration applies per tenant:
    //   (col AT TIME ZONE 'UTC') AT TIME ZONE tz
    // A legacy value of 14:30Z (meaning 14:30 IST wall clock) becomes 09:00Z.
    const rows = await prisma.$queryRawUnsafe<Array<{ converted: Date }>>(
      `SELECT (TIMESTAMPTZ '2026-11-10 14:30:00+00' AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata' AS converted`,
    );
    expect(rows[0]?.converted.toISOString()).toBe('2026-11-10T09:00:00.000Z');
  });
});
