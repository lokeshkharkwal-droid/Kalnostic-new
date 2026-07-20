import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env into process.env before the Prisma client is constructed, without a
// dotenv dependency (keeps the project `tsc --noEmit` gate green under pnpm).
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
  /* .env is optional — the suite self-skips if the DB is unreachable */
}

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PhleboServiceType,
  PhlebotomistScheduleStatus,
  RecurrencePattern,
  SlotStatus,
} from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { SlotReservationService } from './../src/modules/phlebotomist-schedule/slot-reservation.service';
import { KaltrosException } from './../src/common/exceptions/kaltros.exception';

/**
 * End-to-end concurrency test for the home-visit slot reservation gate
 * (`SlotReservationService`) — the fix for the booking race condition.
 *
 * It seeds a real phlebotomist schedule + slot in the dev database and fires many
 * `reserveInTx` calls **concurrently**, each in its own transaction, to prove the
 * conditional atomic counter updates (`bookedCount < capacity`) never oversell a
 * slot or exceed the daily cap under contention.
 *
 * Requires a reachable PostgreSQL (uses the app's `DATABASE_URL`). The whole
 * suite is skipped when no tenant/branch/phlebotomist fixtures exist so it stays
 * green on an empty database. Concurrency is kept at 8 to stay within Prisma's
 * default pool (cpu*2+1).
 */
const CONCURRENCY = 8;
const SLOT_CAPACITY = 3;
const DAILY_CAP = 3;

describe('SlotReservationService concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reservation: SlotReservationService;

  let tenantId: string;
  let branchId: string;
  let phlebA: string; // schedule with slot-capacity gate (no daily cap)
  let phlebB: string; // schedule with daily-cap gate (large slot capacity)
  let ready = false;

  // A fixed, comfortably-future UTC day so `collectionAt` is never in the past.
  const base = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  const slotDate = new Date(Date.UTC(y, m, d));
  const collectionAt = new Date(Date.UTC(y, m, d, 12, 0, 0)); // noon UTC that day

  /** Create an ACTIVE schedule + one all-day slot for a phlebotomist. */
  async function seedSchedule(
    phlebotomistId: string,
    slotCapacity: number,
    maxVisitsPerDay: number,
  ): Promise<void> {
    await prisma.withTenant(tenantId, async (tx) => {
      const schedule = await tx.phlebotomistSchedule.create({
        data: {
          tenantId,
          branchId,
          phlebotomistId,
          serviceType: PhleboServiceType.HOME_COLLECTION,
          status: PhlebotomistScheduleStatus.ACTIVE,
          startTime: '00:00',
          endTime: '23:59',
          intervalMinutes: 60,
          travelBufferMinutes: 0,
          maxVisitsPerDay,
          slotCapacity,
          recurrencePattern: RecurrencePattern.WEEKLY,
        },
        select: { id: true },
      });
      await tx.phlebotomistSlot.create({
        data: {
          tenantId,
          branchId,
          phlebotomistId,
          scheduleId: schedule.id,
          slotDate,
          startTime: '00:00',
          endTime: '23:59',
          slotCapacity,
          bookedCount: 0,
          status: SlotStatus.AVAILABLE,
        },
      });
    });
  }

  /** Remove everything this suite created for a phlebotomist. */
  async function cleanupSchedule(phlebotomistId: string): Promise<void> {
    await prisma.withTenant(tenantId, async (tx) => {
      await tx.phlebotomistSlot.deleteMany({
        where: { tenantId, phlebotomistId, slotDate },
      });
      await tx.phlebotomistDayLoad.deleteMany({
        where: { tenantId, phlebotomistId, loadDate: slotDate },
      });
      await tx.phlebotomistSchedule.deleteMany({
        where: { tenantId, phlebotomistId, branchId },
      });
    });
  }

  /** Fire `n` reservations concurrently, each in its own transaction. */
  async function reserveConcurrently(
    phlebotomistId: string,
    n: number,
  ): Promise<PromiseSettledResult<void>[]> {
    return Promise.allSettled(
      Array.from({ length: n }, () =>
        prisma.withTenant(tenantId, (tx) =>
          reservation.reserveInTx(
            tx,
            tenantId,
            branchId,
            phlebotomistId,
            collectionAt,
          ),
        ),
      ),
    );
  }

  const codesOf = (results: PromiseSettledResult<void>[]): string[] =>
    results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) =>
        r.reason instanceof KaltrosException ? r.reason.errorCode : 'UNKNOWN',
      );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    reservation = app.get(SlotReservationService);

    // Pick any existing branch and derive its tenant — a branch is guaranteed to
    // belong to a tenant, whereas a tenant may have no branch yet.
    const branch = await prisma.branch.findFirst({
      where: { deletedAt: null },
      select: { id: true, tenantId: true },
    });
    const persons = await prisma.person.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 2,
    });
    if (!branch || persons.length < 2) return;
    tenantId = branch.tenantId;
    branchId = branch.id;
    phlebA = persons[0]!.id;
    phlebB = persons[1]!.id;

    await cleanupSchedule(phlebA);
    await cleanupSchedule(phlebB);
    await seedSchedule(phlebA, SLOT_CAPACITY, 0); // slot gate only
    await seedSchedule(phlebB, 100, DAILY_CAP); // daily-cap gate only
    ready = true;
  }, 60000);

  afterAll(async () => {
    if (ready) {
      await cleanupSchedule(phlebA);
      await cleanupSchedule(phlebB);
    }
    await app?.close();
  });

  it('has fixtures to run against (skips otherwise)', () => {
    if (!ready) {
      console.warn(
        'SKIP: needs a tenant + branch + 2 persons in the database.',
      );
    }
    expect(true).toBe(true);
  });

  it('never oversells a slot under concurrent bookings', async () => {
    if (!ready) return;

    const results = await reserveConcurrently(phlebA, CONCURRENCY);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const codes = codesOf(results);

    // Exactly slotCapacity reservations win; the rest are rejected as SLOT_FULL.
    expect(ok).toBe(SLOT_CAPACITY);
    expect(codes).toHaveLength(CONCURRENCY - SLOT_CAPACITY);
    expect(codes.every((c) => c === 'PHLEBOTOMIST_SLOT_FULL')).toBe(true);

    // The persisted counter matches the winners exactly (no lost/double counts).
    const slot = await prisma.phlebotomistSlot.findFirst({
      where: { tenantId, phlebotomistId: phlebA, slotDate },
      select: { bookedCount: true },
    });
    expect(slot?.bookedCount).toBe(SLOT_CAPACITY);
  }, 60000);

  it('enforces the daily cap under concurrent bookings and rolls back losers', async () => {
    if (!ready) return;

    const results = await reserveConcurrently(phlebB, CONCURRENCY);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const codes = codesOf(results);

    // The slot has room (capacity 100); only the daily cap gates here.
    expect(ok).toBe(DAILY_CAP);
    expect(codes.every((c) => c === 'PHLEBOTOMIST_DAILY_CAP_REACHED')).toBe(
      true,
    );

    // Losers rolled back their slot increment, so both counters equal the cap.
    const slot = await prisma.phlebotomistSlot.findFirst({
      where: { tenantId, phlebotomistId: phlebB, slotDate },
      select: { bookedCount: true },
    });
    const dayLoad = await prisma.phlebotomistDayLoad.findFirst({
      where: { tenantId, phlebotomistId: phlebB, loadDate: slotDate },
      select: { bookedCount: true },
    });
    expect(slot?.bookedCount).toBe(DAILY_CAP);
    expect(dayLoad?.bookedCount).toBe(DAILY_CAP);
  }, 60000);

  it('releases a reserved opening so it can be re-booked', async () => {
    if (!ready) return;
    // phlebA is full (bookedCount === SLOT_CAPACITY) from the first test.

    await prisma.withTenant(tenantId, (tx) =>
      reservation.releaseInTx(tx, tenantId, branchId, phlebA, collectionAt),
    );
    const afterRelease = await prisma.phlebotomistSlot.findFirst({
      where: { tenantId, phlebotomistId: phlebA, slotDate },
      select: { bookedCount: true },
    });
    expect(afterRelease?.bookedCount).toBe(SLOT_CAPACITY - 1);

    // The freed opening can be reserved again.
    await prisma.withTenant(tenantId, (tx) =>
      reservation.reserveInTx(tx, tenantId, branchId, phlebA, collectionAt),
    );
    const afterRebook = await prisma.phlebotomistSlot.findFirst({
      where: { tenantId, phlebotomistId: phlebA, slotDate },
      select: { bookedCount: true },
    });
    expect(afterRebook?.bookedCount).toBe(SLOT_CAPACITY);
  }, 60000);
});
