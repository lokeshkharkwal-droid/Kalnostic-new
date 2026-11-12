import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env into process.env before the Prisma client is constructed, without a
// dotenv dependency. A DATABASE_URL already in the environment wins, so the suite
// can be pointed at a throwaway database:
//   DATABASE_URL=postgres://…/scratch_db pnpm test:e2e -- barcode-counter
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

import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BarcodeCounterKind } from '@prisma/client';
import { PrismaService } from './../src/prisma/prisma.service';
import { BarcodeService } from './../src/modules/accession/barcode.service';
import { UploadsService } from './../src/modules/uploads/uploads.service';

/**
 * Real-PostgreSQL concurrency test for the tenant-wide barcode counter
 * (`TenantBarcodeCounter`, used by `BarcodeService`).
 *
 * Fires many allocations at once, each in its own tenant-scoped transaction and
 * from different branches, and checks the properties the counter promises:
 * every barcode is distinct, numbers are issued without gaps, the tenant's very
 * first allocation creates the counter row without a race, order and sample
 * counters are independent, and a rolled-back transaction gives its number back.
 *
 * Isolation: it uses a freshly generated tenant id that owns no data (the
 * counter table has no foreign key to tenants), so the clash checks find
 * nothing and no real tenant's rows are touched. It deletes its counter rows
 * afterwards. Skips itself if the database is unreachable or not yet migrated.
 */
const CONCURRENCY = 12;
const BRANCHES = ['branch-a', 'branch-b', 'branch-c', 'branch-d'];

describe('Tenant barcode counter concurrency (e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let barcodes: BarcodeService;
  let ready = false;
  const tenantIds: string[] = [];

  /** A brand-new tenant id with no counter rows and no orders/samples. */
  const freshTenant = (): string => {
    const id = `e2e-barcode-${randomUUID()}`;
    tenantIds.push(id);
    return id;
  };

  const allocate = (
    tenantId: string,
    kind: BarcodeCounterKind,
    branchId: string,
  ): Promise<string> =>
    prisma.withTenant(tenantId, (tx) =>
      kind === BarcodeCounterKind.ORDER
        ? barcodes.allocateOrderNumberInTx(tx, tenantId, branchId)
        : barcodes.allocateNumberInTx(tx, tenantId, branchId),
    );

  const counterValue = async (
    tenantId: string,
    kind: BarcodeCounterKind,
  ): Promise<number | undefined> =>
    (
      await prisma.withTenant(tenantId, (tx) =>
        tx.tenantBarcodeCounter.findUnique({
          where: { tenantId_kind: { tenantId, kind } },
          select: { currentNumber: true },
        }),
      )
    )?.currentNumber;

  const range = (from: number, count: number): string[] =>
    Array.from({ length: count }, (_, i) => String(from + i));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        BarcodeService,
        { provide: UploadsService, useValue: {} },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    barcodes = moduleRef.get(BarcodeService);
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1 FROM "tenant_barcode_counters" LIMIT 1`;
      ready = true;
    } catch {
      ready = false;
    }
  });

  afterAll(async () => {
    if (ready) {
      for (const tenantId of tenantIds) {
        await prisma.withTenant(tenantId, (tx) =>
          tx.tenantBarcodeCounter.deleteMany({ where: { tenantId } }),
        );
      }
    }
    await moduleRef?.close();
  });

  it('has a migrated database to run against (skips otherwise)', () => {
    if (!ready) {
      console.warn(
        'tenant_barcode_counters not reachable — skipping barcode counter e2e',
      );
    }
    expect(true).toBe(true);
  });

  it('issues distinct, gap-free numbers to simultaneous allocations from many branches, starting a new tenant at 10001', async () => {
    if (!ready) return;
    const tenantId = freshTenant();

    // All start at once on a tenant with no counter row: the first statements
    // race to create it, and every allocation must still get its own number.
    const values = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        allocate(
          tenantId,
          BarcodeCounterKind.ORDER,
          BRANCHES[i % BRANCHES.length]!,
        ),
      ),
    );

    expect(new Set(values).size).toBe(CONCURRENCY);
    expect([...values].sort()).toEqual(range(10001, CONCURRENCY));
    expect(await counterValue(tenantId, BarcodeCounterKind.ORDER)).toBe(
      10000 + CONCURRENCY,
    );
  });

  it('keeps order and sample numbers on independent counters under concurrent use', async () => {
    if (!ready) return;
    const tenantId = freshTenant();

    const jobs = Array.from({ length: CONCURRENCY * 2 }, (_, i) => ({
      kind: i % 2 ? BarcodeCounterKind.SAMPLE : BarcodeCounterKind.ORDER,
      branchId: BRANCHES[i % BRANCHES.length]!,
    }));
    const results = await Promise.all(
      jobs.map(async (job) => ({
        kind: job.kind,
        value: await allocate(tenantId, job.kind, job.branchId),
      })),
    );

    for (const kind of [BarcodeCounterKind.ORDER, BarcodeCounterKind.SAMPLE]) {
      const issued = results.filter((r) => r.kind === kind).map((r) => r.value);
      expect([...issued].sort()).toEqual(range(10001, CONCURRENCY));
      expect(await counterValue(tenantId, kind)).toBe(10000 + CONCURRENCY);
    }
  });

  it('gives a rolled-back allocation its number back, so committed numbers stay gap-free', async () => {
    if (!ready) return;
    const tenantId = freshTenant();
    class Rollback extends Error {}

    // Every third allocation's transaction fails after the number was issued
    // (as an order create would if a later step threw).
    const outcomes = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        prisma.withTenant(tenantId, async (tx) => {
          const value = await barcodes.allocateOrderNumberInTx(
            tx,
            tenantId,
            BRANCHES[i % BRANCHES.length]!,
          );
          if (i % 3 === 0) throw new Rollback(value);
          return value;
        }),
      ),
    );

    const committed = outcomes
      .filter(
        (o): o is PromiseFulfilledResult<string> => o.status === 'fulfilled',
      )
      .map((o) => o.value);
    const rolledBack = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    );
    expect(rolledBack.length).toBe(Math.ceil(CONCURRENCY / 3));
    expect(rolledBack.every((o) => o.reason instanceof Rollback)).toBe(true);
    expect(new Set(committed).size).toBe(committed.length);
    expect([...committed].sort()).toEqual(range(10001, committed.length));
    expect(await counterValue(tenantId, BarcodeCounterKind.ORDER)).toBe(
      10000 + committed.length,
    );
  });

  it('continues from the stored counter (e.g. the value the migration started it at)', async () => {
    if (!ready) return;
    const tenantId = freshTenant();
    await prisma.withTenant(tenantId, (tx) =>
      tx.tenantBarcodeCounter.create({
        data: {
          tenantId,
          kind: BarcodeCounterKind.ORDER,
          currentNumber: 11985,
        },
      }),
    );

    const values = await Promise.all(
      BRANCHES.map((branchId) =>
        allocate(tenantId, BarcodeCounterKind.ORDER, branchId),
      ),
    );

    expect([...values].sort()).toEqual(range(11986, BRANCHES.length));
  });
});
