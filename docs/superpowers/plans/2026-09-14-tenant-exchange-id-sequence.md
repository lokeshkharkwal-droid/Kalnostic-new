# Tenant Exchange ID Sequence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every tenant a stable integer `exchangeTenantId` — migrated tenants keep their original EzHealthTrack `BUSINESS_ID`, native tenants get the next value in that sequence — and send it (not the UUID) to the exchange server so per-tenant message counts continue.

**Architecture:** Add a nullable-unique `exchangeTenantId` column on `Tenant` plus a platform-level `PlatformCounter` table as an atomic allocator. A small `ExchangeTenantIdService` owns allocation/seed logic; `TenantService.create()` calls it inside its existing transaction. A one-time idempotent backfill script fills existing rows. The communication dispatcher resolves and sends the integer.

**Tech Stack:** NestJS, Prisma (PostgreSQL), TypeScript strict, Jest (ts-jest), ts-node scripts.

**Working directory:** All commands run from `kalnostics-new/` (the backend + git repo), per CLAUDE.md §0.

---

## File Structure

- **Create:** `src/modules/tenant/exchange-tenant-id.service.ts` — allocator + seed logic (allocate / bumpTo / resolveForCreate / seedFloor).
- **Create:** `src/modules/tenant/exchange-tenant-id.service.spec.ts` — unit tests (tx-mock style).
- **Create:** `scripts/sync-tenant-exchange-id.ts` — one-time idempotent backfill.
- **Create:** `prisma/migrations/20260914120000_add_tenant_exchange_id_sequence/migration.sql` — schema migration.
- **Modify:** `prisma/schema.prisma` — add `Tenant.exchangeTenantId` + `PlatformCounter` model.
- **Modify:** `src/modules/tenant/tenant.module.ts` — register `ExchangeTenantIdService`.
- **Modify:** `src/modules/tenant/tenant.service.ts` — inject service, set `exchangeTenantId` in `create()`.
- **Modify:** `src/modules/communication/communication.service.ts` — send `exchangeTenantId` as `peer_tenant_id`.
- **Modify:** `src/modules/communication/communication.service.spec.ts` (create if absent) — dispatch peer test.
- **Modify:** `package.json` — add `sync:tenant-exchange-id` script.

---

## Task 1: Schema + migration (exchangeTenantId + PlatformCounter)

**Files:**
- Modify: `prisma/schema.prisma` (Tenant model ~line 892; add a new model near the other platform-level models)
- Create: `prisma/migrations/20260914120000_add_tenant_exchange_id_sequence/migration.sql`

- [ ] **Step 1: Add the column + model to `schema.prisma`**

In `model Tenant`, directly under the existing `legacyTenantId` line (`prisma/schema.prisma:892`), add:

```prisma
  /// Integer id sent to the Exchange server as `peer_tenant_id` so per-tenant
  /// message counts continue. Equals `legacyTenantId` for migrated tenants; a
  /// fresh value from the `exchange_tenant_id` PlatformCounter for native ones.
  exchangeTenantId Int? @unique @map("exchange_tenant_id")
```

Add this new model (place it beside the other platform-level models, e.g. just after the `Tenant` model's closing brace):

```prisma
/// Platform-level (no tenantId, no RLS) monotonic counters spanning all tenants.
/// One row per logical sequence, keyed by `key`. `value` = last-assigned value.
model PlatformCounter {
  key       String   @id
  value     Int      @default(0)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("platform_counters")
}
```

- [ ] **Step 2: Generate the diff SQL into the migration folder**

Run (creates the folder, then writes SQL into it):

```bash
mkdir -p prisma/migrations/20260914120000_add_tenant_exchange_id_sequence
pnpm prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/20260914120000_add_tenant_exchange_id_sequence/migration.sql
```

Expected: `migration.sql` contains `ALTER TABLE "tenants" ADD COLUMN "exchange_tenant_id"`, a unique index, and `CREATE TABLE "platform_counters"`.

- [ ] **Step 3: Append the counter seed row to the migration**

Add this to the **end** of `prisma/migrations/20260914120000_add_tenant_exchange_id_sequence/migration.sql` (the `updated_at` column is `NOT NULL`, so a value is required on raw insert):

```sql

-- Seed the Exchange tenant-id counter row (value 0 = nothing allocated yet).
INSERT INTO "platform_counters" ("key", "value", "updated_at")
VALUES ('exchange_tenant_id', 0, NOW());
```

Do **not** add any RLS policy — `platform_counters` is platform-level like `tenants` (no `ENABLE ROW LEVEL SECURITY`). `rls.sql` is unchanged.

- [ ] **Step 4: Regenerate the Prisma client**

Stop any running node process first (Windows DLL lock — see memory `prisma-migrate-drift-and-dll-lock`), then:

```bash
pnpm prisma generate
```

Expected: "Generated Prisma Client". `PrismaService` now exposes `platformCounter` and `Tenant.exchangeTenantId`.

- [ ] **Step 5: Apply locally**

Local dev uses `db push` (migrate dev is blocked — memory `prisma-migrate-drift-and-dll-lock`):

```bash
pnpm prisma db push
```

Then manually insert the seed row locally (db push does not run the migration's INSERT):

```bash
pnpm prisma db execute --stdin <<'SQL'
INSERT INTO "platform_counters" ("key","value","updated_at")
VALUES ('exchange_tenant_id', 0, NOW())
ON CONFLICT ("key") DO NOTHING;
SQL
```

Expected: `platform_counters` has one row `('exchange_tenant_id', 0)`; `tenants.exchange_tenant_id` exists and is NULL for all rows.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260914120000_add_tenant_exchange_id_sequence/
git commit -m "feat(tenant): add exchangeTenantId column and PlatformCounter allocator"
```

---

## Task 2: ExchangeTenantIdService (allocator + seed logic)

**Files:**
- Create: `src/modules/tenant/exchange-tenant-id.service.ts`
- Test: `src/modules/tenant/exchange-tenant-id.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/tenant/exchange-tenant-id.service.spec.ts`:

```ts
import {
  EXCHANGE_TENANT_ID_COUNTER_KEY,
  ExchangeTenantIdService,
} from './exchange-tenant-id.service';

describe('ExchangeTenantIdService', () => {
  const tx = {
    platformCounter: {
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    tenant: { aggregate: jest.fn() },
  };
  let service: ExchangeTenantIdService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExchangeTenantIdService();
  });

  const asTx = () => tx as unknown as Parameters<typeof service.allocate>[0];

  it('allocate increments the counter and returns the new value', async () => {
    tx.platformCounter.update.mockResolvedValue({ value: 106 });
    const id = await service.allocate(asTx());
    expect(id).toBe(106);
    expect(tx.platformCounter.update).toHaveBeenCalledWith({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY },
      data: { value: { increment: 1 } },
      select: { value: true },
    });
  });

  it('bumpTo only raises the counter (never lowers)', async () => {
    tx.platformCounter.updateMany.mockResolvedValue({ count: 1 });
    await service.bumpTo(asTx(), 200);
    expect(tx.platformCounter.updateMany).toHaveBeenCalledWith({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY, value: { lt: 200 } },
      data: { value: 200 },
    });
  });

  it('resolveForCreate keeps a migrated legacy id and bumps the counter', async () => {
    tx.platformCounter.updateMany.mockResolvedValue({ count: 1 });
    const id = await service.resolveForCreate(asTx(), 105);
    expect(id).toBe(105);
    expect(tx.platformCounter.updateMany).toHaveBeenCalled();
    expect(tx.platformCounter.update).not.toHaveBeenCalled();
  });

  it('resolveForCreate allocates for a native tenant (no legacy id)', async () => {
    tx.platformCounter.update.mockResolvedValue({ value: 107 });
    const id = await service.resolveForCreate(asTx(), null);
    expect(id).toBe(107);
    expect(tx.platformCounter.update).toHaveBeenCalled();
  });

  it('seedFloor raises the counter to the max of counter/legacy/exchange', async () => {
    tx.tenant.aggregate.mockResolvedValue({
      _max: { legacyTenantId: 105, exchangeTenantId: 105 },
    });
    tx.platformCounter.findUnique.mockResolvedValue({ value: 0 });
    tx.platformCounter.updateMany.mockResolvedValue({ count: 1 });
    const floor = await service.seedFloor(asTx());
    expect(floor).toBe(105);
    expect(tx.platformCounter.updateMany).toHaveBeenCalledWith({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY, value: { lt: 105 } },
      data: { value: 105 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest src/modules/tenant/exchange-tenant-id.service.spec.ts`
Expected: FAIL — cannot find module `./exchange-tenant-id.service`.

- [ ] **Step 3: Write the service**

Create `src/modules/tenant/exchange-tenant-id.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** PlatformCounter row key for the Exchange tenant-id sequence. */
export const EXCHANGE_TENANT_ID_COUNTER_KEY = 'exchange_tenant_id';

/**
 * Minimal transaction-client surface this service needs. Accepting a narrowed
 * `Prisma.TransactionClient` keeps callers passing their own active `tx` (so the
 * counter update joins the caller's transaction) and keeps the service unit-testable.
 */
export type ExchangeIdTx = Pick<Prisma.TransactionClient, 'platformCounter' | 'tenant'>;

/**
 * Owns the global, monotonic Exchange tenant-id sequence. All methods operate on
 * a caller-supplied transaction so allocation is atomic with the tenant write.
 */
@Injectable()
export class ExchangeTenantIdService {
  /**
   * Atomically allocate the next Exchange tenant id. The row lock taken by the
   * increment serialises concurrent tenant creates, so no two get the same id.
   * @param tx active Prisma transaction client
   * @returns the newly-allocated integer id
   */
  async allocate(tx: ExchangeIdTx): Promise<number> {
    const { value } = await tx.platformCounter.update({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY },
      data: { value: { increment: 1 } },
      select: { value: true },
    });
    return value;
  }

  /**
   * Raise the counter to at least `value` (never lowers it). Used when a migrated
   * tenant carries its own legacy id, to keep the high-water mark ahead of it.
   * @param tx active Prisma transaction client
   * @param value id the counter must be at or above
   */
  async bumpTo(tx: ExchangeIdTx, value: number): Promise<void> {
    await tx.platformCounter.updateMany({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY, value: { lt: value } },
      data: { value },
    });
  }

  /**
   * Resolve the `exchangeTenantId` for a tenant being created: migrated tenants
   * (a `legacyTenantId` is supplied) keep that exact id and bump the counter;
   * native tenants receive the next allocated id.
   * @param tx active Prisma transaction client
   * @param legacyTenantId source legacy id, or null/undefined for native tenants
   * @returns the integer to store as `exchangeTenantId`
   */
  async resolveForCreate(
    tx: ExchangeIdTx,
    legacyTenantId: number | null | undefined,
  ): Promise<number> {
    if (legacyTenantId != null) {
      await this.bumpTo(tx, legacyTenantId);
      return legacyTenantId;
    }
    return this.allocate(tx);
  }

  /**
   * Seed the counter to the current high-water mark:
   * `GREATEST(counter, MAX(legacyTenantId), MAX(exchangeTenantId))`. Idempotent —
   * only ever raises the counter. Run before backfilling native tenants.
   * @param tx active Prisma transaction client
   * @returns the floor the counter was set to
   */
  async seedFloor(tx: ExchangeIdTx): Promise<number> {
    const agg = await tx.tenant.aggregate({
      _max: { legacyTenantId: true, exchangeTenantId: true },
    });
    const current = await tx.platformCounter.findUnique({
      where: { key: EXCHANGE_TENANT_ID_COUNTER_KEY },
      select: { value: true },
    });
    const floor = Math.max(
      current?.value ?? 0,
      agg._max.legacyTenantId ?? 0,
      agg._max.exchangeTenantId ?? 0,
    );
    await this.bumpTo(tx, floor);
    return floor;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm jest src/modules/tenant/exchange-tenant-id.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/tenant/exchange-tenant-id.service.ts src/modules/tenant/exchange-tenant-id.service.spec.ts
git commit -m "feat(tenant): add ExchangeTenantIdService allocator"
```

---

## Task 3: Wire allocation into tenant creation

**Files:**
- Modify: `src/modules/tenant/tenant.module.ts:32-33`
- Modify: `src/modules/tenant/tenant.service.ts` (constructor; `create()` transaction ~line 224-248)

- [ ] **Step 1: Register the provider in `TenantModule`**

In `src/modules/tenant/tenant.module.ts`, add the import and include the service in `providers` and `exports` (exported so the backfill script can `app.get()` it):

```ts
import { ExchangeTenantIdService } from './exchange-tenant-id.service';
```

```ts
  providers: [TenantService, ExchangeTenantIdService],
  exports: [TenantService, ExchangeTenantIdService],
```

- [ ] **Step 2: Inject the service into `TenantService`**

In `src/modules/tenant/tenant.service.ts`, add the import near the other module imports:

```ts
import { ExchangeTenantIdService } from './exchange-tenant-id.service';
```

Add it to the constructor parameter list (after the existing injected members — match the existing constructor style):

```ts
    private readonly exchangeTenantIdService: ExchangeTenantIdService,
```

- [ ] **Step 3: Set `exchangeTenantId` inside the create transaction**

In `create()`, inside the `this.prisma.$transaction(async (tx) => {` block (`tenant.service.ts:224`), **before** the `const created = await tx.tenant.create({` call, resolve the id:

```ts
        const exchangeTenantId =
          await this.exchangeTenantIdService.resolveForCreate(
            tx,
            options?.legacyTenantId ?? null,
          );
```

Then in the `tx.tenant.create({ data: { ... } })` object, alongside the existing `legacyTenantId: options?.legacyTenantId ?? null,` line (`tenant.service.ts:246`), add:

```ts
            exchangeTenantId,
```

- [ ] **Step 4: Type-check**

Run: `pnpm type-check`
Expected: no errors. (`tx` is `Prisma.TransactionClient`, assignable to the service's `ExchangeIdTx`.)

- [ ] **Step 5: Manual smoke — create a native tenant**

Start the app (`pnpm start:dev`), create a tenant via the SiteAdmin create endpoint (or `bruno`), then verify in the DB:

```bash
pnpm prisma db execute --stdin <<'SQL'
SELECT id, legacy_tenant_id, exchange_tenant_id FROM "tenants" ORDER BY created_at DESC LIMIT 3;
SELECT * FROM "platform_counters";
SQL
```

Expected: the new tenant has a non-null `exchange_tenant_id` = counter `value`; `platform_counters.value` advanced by 1.

- [ ] **Step 6: Commit**

```bash
git add src/modules/tenant/tenant.module.ts src/modules/tenant/tenant.service.ts
git commit -m "feat(tenant): assign exchangeTenantId on tenant create"
```

---

## Task 4: Backfill sync script

**Files:**
- Create: `scripts/sync-tenant-exchange-id.ts`
- Modify: `package.json` (scripts block ~line 25)

- [ ] **Step 1: Write the script**

Create `scripts/sync-tenant-exchange-id.ts`:

```ts
/**
 * One-time, idempotent backfill: give every existing tenant an `exchangeTenantId`.
 *
 *   pnpm sync:tenant-exchange-id
 *
 * Order (single transaction):
 *   1. Seed the counter to GREATEST(counter, MAX(legacyTenantId), MAX(exchangeTenantId)).
 *   2. Migrated-missing (legacyTenantId set, exchangeTenantId NULL) → mirror legacyTenantId.
 *   3. Native-missing (both NULL) → allocate sequentially by createdAt.
 *
 * Safe to run repeatedly: only NULL rows are touched; existing ids never change;
 * the counter only ever rises. Only touches platform-level tables (no RLS).
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExchangeTenantIdService } from '../src/modules/tenant/exchange-tenant-id.service';

async function main(): Promise<void> {
  const logger = new Logger('sync-tenant-exchange-id');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const exchangeIds = app.get(ExchangeTenantIdService);

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const floor = await exchangeIds.seedFloor(tx);

      const migratedMissing = await tx.tenant.findMany({
        where: {
          exchangeTenantId: null,
          legacyTenantId: { not: null },
          deletedAt: null,
        },
        select: { id: true, legacyTenantId: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      for (const t of migratedMissing) {
        if (t.legacyTenantId == null) continue;
        await tx.tenant.update({
          where: { id: t.id },
          data: { exchangeTenantId: t.legacyTenantId },
        });
        await exchangeIds.bumpTo(tx, t.legacyTenantId);
      }

      const nativeMissing = await tx.tenant.findMany({
        where: {
          exchangeTenantId: null,
          legacyTenantId: null,
          deletedAt: null,
        },
        select: { id: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      for (const t of nativeMissing) {
        const id = await exchangeIds.allocate(tx);
        await tx.tenant.update({
          where: { id: t.id },
          data: { exchangeTenantId: id },
        });
      }

      return {
        floor,
        migrated: migratedMissing.length,
        native: nativeMissing.length,
      };
    });

    logger.log(
      `Seed floor=${summary.floor}; mirrored ${summary.migrated} migrated, ` +
        `allocated ${summary.native} native tenant id(s).`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the package.json script**

In `package.json`, next to the other migration scripts (`package.json:25`), add:

```json
    "sync:tenant-exchange-id": "ts-node --transpile-only -r tsconfig-paths/register scripts/sync-tenant-exchange-id.ts",
```

- [ ] **Step 3: Type-check**

Run: `pnpm type-check`
Expected: no errors.

- [ ] **Step 4: Run the backfill locally + verify idempotency**

```bash
pnpm sync:tenant-exchange-id
```

Expected log: `Seed floor=<n>; mirrored <a> migrated, allocated <b> native tenant id(s).`

Verify every tenant now has an id, and no duplicates:

```bash
pnpm prisma db execute --stdin <<'SQL'
SELECT COUNT(*) AS missing FROM "tenants" WHERE exchange_tenant_id IS NULL AND deleted_at IS NULL;
SELECT exchange_tenant_id, COUNT(*) FROM "tenants" WHERE exchange_tenant_id IS NOT NULL GROUP BY exchange_tenant_id HAVING COUNT(*) > 1;
SQL
```

Expected: `missing = 0`; the duplicate query returns **no rows**.

Run the script a **second** time — expected log: `mirrored 0 migrated, allocated 0 native` (idempotent no-op).

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-tenant-exchange-id.ts package.json
git commit -m "feat(tenant): add idempotent exchangeTenantId backfill script"
```

---

## Task 5: Send the integer id to the exchange (dispatch)

**Files:**
- Modify: `src/modules/communication/communication.service.ts` (imports line 1; `dispatch()` peer block ~line 269-275)
- Test: `src/modules/communication/communication.service.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `src/modules/communication/communication.service.spec.ts` (or add the `describe` block if the file exists):

```ts
import { MessagingChannel } from '@prisma/client';
import { CommunicationService } from './communication.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeClient } from './exchange/exchange.client';
import { TemplateService } from '../template/template.service';
import { BranchService } from '../branch/branch.service';

describe('CommunicationService.dispatch — peer tenant id', () => {
  const tenantFindUnique = jest.fn();
  const sendSms = jest.fn().mockResolvedValue({ id: 'ok' });
  let service: CommunicationService;

  const buildRow = () =>
    ({
      id: 'log-1',
      tenantId: 'uuid-tenant-1',
      branchId: null,
      channel: MessagingChannel.SMS,
      toAddress: '9999999999',
      subject: null,
      body: 'hi',
      feature: 'ad_hoc',
      payload: null,
    }) as unknown as Parameters<CommunicationService['dispatch']>[0];

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CommunicationService(
      { tenant: { findUnique: tenantFindUnique } } as unknown as PrismaService,
      { sendSms } as unknown as ExchangeClient,
      {} as unknown as TemplateService,
      {} as unknown as BranchService,
    );
  });

  it('sends the integer exchangeTenantId as peer.tenantId', async () => {
    tenantFindUnique.mockResolvedValue({ exchangeTenantId: 106 });
    await service.dispatch(buildRow());
    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: '106' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('blocks the send (returns null) when exchangeTenantId is missing', async () => {
    tenantFindUnique.mockResolvedValue({ exchangeTenantId: null });
    const result = await service.dispatch(buildRow());
    expect(result).toBeNull();
    expect(sendSms).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm jest src/modules/communication/communication.service.spec.ts`
Expected: FAIL — dispatch sends `tenantId: 'uuid-tenant-1'`, not `'106'` (and does not block on null).

- [ ] **Step 3: Add a logger import**

In `src/modules/communication/communication.service.ts`, change the first import (line 1) from:

```ts
import { Injectable } from '@nestjs/common';
```

to:

```ts
import { Injectable, Logger } from '@nestjs/common';
```

Add a logger field as the first line inside the class body (just above `constructor(`):

```ts
  private readonly logger = new Logger(CommunicationService.name);
```

- [ ] **Step 4: Resolve + send the integer id in `dispatch()`**

In `dispatch()` (`communication.service.ts:269`), replace the peer block:

```ts
    const peer = {
      tenantId: row.tenantId,
      branchId: row.branchId ?? '',
    };
```

with:

```ts
    // The Exchange server counts messages per integer tenant id (peer_tenant_id).
    // Resolve the tenant's stable exchangeTenantId; never fall back to the UUID,
    // or counts land in the wrong bucket. `tenants` is platform-level (no RLS).
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: row.tenantId },
      select: { exchangeTenantId: true },
    });
    if (tenant?.exchangeTenantId == null) {
      this.logger.error(
        `Cannot dispatch communication ${row.id}: tenant ${row.tenantId} has ` +
          `no exchangeTenantId (run 'pnpm sync:tenant-exchange-id').`,
      );
      return null;
    }
    const peer = {
      tenantId: String(tenant.exchangeTenantId),
      branchId: row.branchId ?? '',
    };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm jest src/modules/communication/communication.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/communication/communication.service.ts src/modules/communication/communication.service.spec.ts
git commit -m "feat(communication): send exchangeTenantId as peer_tenant_id"
```

---

## Task 6: Full validation gate

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: all suites pass (including the 3 new specs).

- [ ] **Step 2: Run the repo validate gate**

Run: `pnpm validate`
Expected: `type-check`, `lint`, and `format:check` all pass. (No `any`, all public methods have JSDoc — Task 2 service satisfies rule #5.)

- [ ] **Step 3: Confirm no API-surface / RLS drift**

No new endpoint or request/response contract changed (backfill is a script; `create()` signature is unchanged; dispatch is internal), so `docs/api.html` and the Bruno collection need no update. Confirm `prisma/rls.sql` is unchanged (no policy for `platform_counters`).

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore(tenant): formatting + lint fixes for exchangeTenantId work"
```

---

## Production rollout runbook (execute after merge — see spec §3a, §6)

> **Gate (spec §3a):** before this rollout, confirm with the exchange owner that counts key on `peer_tenant_id` alone (P1) and that kalnostics-new sends under the same credential + prod host the historical counts live under (P2); run the single-tenant live test. Do not open native tenant creation until steps 2–3 complete.

1. Deploy the schema migration: `pnpm prisma migrate deploy` (applies `20260914120000_add_tenant_exchange_id_sequence`, including the counter seed row).
2. Run `pnpm migrate:ezht` for every legacy `BUSINESS_ID` (idempotent; each migrated tenant gets `exchangeTenantId = legacyTenantId`).
3. Run `pnpm sync:tenant-exchange-id` (seeds the counter, backfills any missing ids).
4. Verify: `SELECT COUNT(*) FROM tenants WHERE exchange_tenant_id IS NULL AND deleted_at IS NULL;` → 0; all migrated ids equal their `legacy_tenant_id`.

---

## Notes / constraints carried from the spec

- **Floor = MAX(legacyTenantId)+1**, accepted (spec §3): safe because `exchangeTenantId` is its own `@unique` column, branch ids never key the tenant counter, and migration is final.
- **Ordering is mandatory:** `migrate:ezht` must finish before any native tenant is assigned (rollout step 2 before native creation opens).
- **Concurrency:** the `platformCounter.update({ increment })` row lock serialises concurrent creates; `Tenant.exchangeTenantId @unique` is the backstop. This guarantee is **DB-level**, not exercisable by the repo's mock-based jest specs (no live-DB integration harness). Optional manual check against a running dev DB: fire N tenant creates in parallel (e.g. `bruno` runner or a short loop) and confirm `SELECT exchange_tenant_id, COUNT(*) FROM tenants GROUP BY 1 HAVING COUNT(*)>1;` returns no rows.
- **Idempotency:** backfill touches only NULL rows; the counter only ever rises.
