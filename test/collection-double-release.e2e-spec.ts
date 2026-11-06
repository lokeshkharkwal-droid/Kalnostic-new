import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env into process.env before Prisma is constructed (mirrors the other
// e2e specs). The suite self-skips when the DB / fixtures are unavailable.
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
  BillingType,
  CollectionPriority,
  CollectionStatus,
  OrderStatus,
  OrderType,
  PhleboServiceType,
  PhlebotomistScheduleStatus,
  RecurrencePattern,
  SlotStatus,
} from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { PhlebotomistCollectionService } from './../src/modules/phlebotomist-collection/phlebotomist-collection.service';

/**
 * Proves the home-visit slot double-release fix: cancelling a `HomeVisitCollection`
 * releases its phlebotomist slot **exactly once**, and re-cancelling an already
 * cancelled collection must NOT decrement the shared slot counter again (which
 * would steal capacity from an unrelated booking in the same window).
 *
 * Setup seeds a slot pre-loaded with `bookedCount = 2` (one booking is the
 * collection under test, the other is a co-booking sharing the window). After the
 * first cancel the counter must read 1 (co-booking intact); a second cancel must
 * leave it at 1 — pre-fix it dropped to 0, corrupting the co-booking.
 *
 * Requires a reachable PostgreSQL with a branch + person + patient. The order code
 * is unique + cleaned up, so the dev DB is left as found.
 */
const ORDER_CODE = 'TZ-DBLREL-TEST';

describe('HomeVisitCollection slot double-release guard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let collections: PhlebotomistCollectionService;

  let tenantId: string;
  let branchId: string;
  let phleb: string;
  let patientId: string;
  let orderId: string;
  let collectionId: string;
  let ready = false;

  const base = new Date(Date.now() + 150 * 24 * 60 * 60 * 1000);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  const slotDate = new Date(Date.UTC(y, m, d));
  // Noon UTC: safely mid-day in every supported zone, so the local projection
  // stays on `slotDate` and inside the all-day slot window.
  const collectionAt = new Date(Date.UTC(y, m, d, 12, 0, 0));

  async function cleanup(): Promise<void> {
    await prisma.withTenant(tenantId, async (tx) => {
      const order = await tx.order.findFirst({
        where: { tenantId, orderCode: ORDER_CODE },
        select: { id: true },
      });
      if (order) {
        // History cascades from the collection; collection cascades from the
        // order — delete explicitly (oldest-first) to be safe regardless.
        await tx.homeVisitCollection.deleteMany({
          where: { tenantId, orderId: order.id },
        });
        await tx.order.deleteMany({ where: { tenantId, id: order.id } });
      }
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

  async function slotBookedCount(): Promise<number | undefined> {
    const slot = await prisma.phlebotomistSlot.findFirst({
      where: { tenantId, phlebotomistId: phleb, slotDate },
      select: { bookedCount: true },
    });
    return slot?.bookedCount;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    collections = app.get(PhlebotomistCollectionService);

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
    const patient = await prisma.patient.findFirst({
      where: { tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) return;
    patientId = patient.id;

    // Clean any leftovers from a previous (possibly crashed) run, then seed fresh.
    await cleanup();
    await prisma.withTenant(tenantId, async (tx) => {
      const schedule = await tx.phlebotomistSchedule.create({
        data: {
          tenantId,
          branchId,
          phlebotomistId: phleb,
          serviceType: PhleboServiceType.HOME_COLLECTION,
          status: PhlebotomistScheduleStatus.ACTIVE,
          startTime: '00:00',
          endTime: '23:59',
          intervalMinutes: 60,
          travelBufferMinutes: 0,
          maxVisitsPerDay: 0, // no daily cap → only the slot counter matters
          slotCapacity: 3,
          recurrencePattern: RecurrencePattern.WEEKLY,
        },
        select: { id: true },
      });
      // Seed the slot already holding TWO bookings (our collection + a co-booking).
      await tx.phlebotomistSlot.create({
        data: {
          tenantId,
          branchId,
          phlebotomistId: phleb,
          scheduleId: schedule.id,
          slotDate,
          startTime: '00:00',
          endTime: '23:59',
          slotCapacity: 3,
          bookedCount: 2,
          status: SlotStatus.BOOKED,
        },
      });
      const order = await tx.order.create({
        data: {
          tenantId,
          branchId,
          patientId,
          orderCode: ORDER_CODE,
          orderDate: slotDate,
          orderType: OrderType.WALK_IN,
          billingType: BillingType.CASH_CLIENT,
          status: OrderStatus.ORDER,
        },
        select: { id: true },
      });
      orderId = order.id;
      const collection = await tx.homeVisitCollection.create({
        data: {
          tenantId,
          branchId,
          orderId,
          phlebotomistId: phleb,
          status: CollectionStatus.SCHEDULED,
          scheduledCollectionAt: collectionAt,
          priority: CollectionPriority.NORMAL,
        },
        select: { id: true },
      });
      collectionId = collection.id;
    });
    ready = true;
  }, 60000);

  afterAll(async () => {
    if (ready) await cleanup();
    await app?.close();
  });

  it('has fixtures to run against (skips otherwise)', () => {
    if (!ready) {
      console.warn('SKIP: needs a tenant + branch + person + patient.');
    }
    expect(true).toBe(true);
  });

  it('cancelling a collection releases its slot exactly once (2 → 1)', async () => {
    if (!ready) return;
    await collections.updateStatus(collectionId, tenantId, null, {
      status: CollectionStatus.CANCELLED,
    });
    expect(await slotBookedCount()).toBe(1);

    const col = await prisma.homeVisitCollection.findUnique({
      where: { id: collectionId },
      select: { status: true },
    });
    expect(col?.status).toBe(CollectionStatus.CANCELLED);
  }, 60000);

  it('re-cancelling an already cancelled collection does NOT double-release (stays 1)', async () => {
    if (!ready) return;
    await collections.updateStatus(collectionId, tenantId, null, {
      status: CollectionStatus.CANCELLED,
    });
    // The co-booking's capacity is preserved — pre-fix this dropped to 0.
    expect(await slotBookedCount()).toBe(1);
  }, 60000);
});
