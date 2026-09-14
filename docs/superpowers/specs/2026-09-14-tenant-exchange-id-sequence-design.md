# Tenant Exchange ID Sequence — Design

**Date:** 2026-09-14
**Status:** Draft (awaiting review)
**Area:** `kalnostics-new` — `tenant`, `communication` modules + prod migration

---

## 1. Problem

Every outbound Email/SMS/WhatsApp is delegated to an external **Exchange
server**, which tallies message counts **per tenant**, keyed on the integer
`peer_tenant_id` it receives. In legacy **EzHealthTrack** that integer was the
tenant's `business_info.BUSINESS_ID`.

In `kalnostics-new`:

- Tenants are identified by **UUID** (`Tenant.id`), and dispatch currently sends
  that UUID as `peer_tenant_id` (`communication.service.ts:273`). The exchange
  therefore sees every tenant as brand-new and cannot continue historical
  counts.
- Migrated tenants already carry their original id in `Tenant.legacyTenantId`
  (`Int? @unique`); natively-created tenants have `NULL`.

**Goal:** send a stable integer id to the exchange for every tenant —
preserving migrated tenants' original ids exactly, assigning fresh unique ids to
tenants that lack one, and continuing the sequence automatically for all future
tenants, concurrency-safely and idempotently.

---

## 2. Verified constraints (EzHealthTrack + current code)

1. **`BUSINESS_ID` is a single `AUTO_INCREMENT`** (`kjLocalDbDump.sql:2206`)
   shared across **tenants and branches** — branches are `business_info` rows
   with `BUSINESS_PARENT = <tenant BUSINESS_ID>`. The new DB splits that one
   sequence into `Tenant.legacyTenantId` and `Branch.legacyBranchId`
   (`migrate-ezhealthtrack.ts:506`).
2. **The exchange keys on `peer_tenant_id` only**, and legacy sends the **parent
   business** id (`UserSession.php:547` — the `entity_type=BUSINESS` role;
   branches send under their tenant). Branch `BUSINESS_ID`s never key the tenant
   counter.
3. **Ordering is mandatory.** `migrate:ezht` must fully complete in prod
   **before** any native tenant is assigned an id; otherwise a later legacy
   import could carry a `BUSINESS_ID` already handed to a native tenant.
   Migration is **final**, so this is enforced by runbook ordering.
4. **`MAX()+1` in application code is not concurrency-safe** — needs an atomic
   allocator.
5. **`Tenant` is platform-level (no RLS)** — a global `MAX`/counter is safe, but
   the allocator must live in a platform-level table (no RLS policy).
6. **`TenantService.create()` already accepts `legacyTenantId`**
   (`tenant.service.ts:169`, applied inside the `$transaction` at line 224) —
   the exact hook point for allocation.

---

## 3. Locked decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| **Storage** | New dedicated column `Tenant.exchangeTenantId Int? @unique` | Keeps `legacyTenantId` meaning "came from EzHealthTrack" intact and keeps `migrate:ezht`'s idempotency key clean. |
| **Floor** | `MAX(exchangeTenantId) + 1` (≡ `MAX(legacyTenantId)+1` at seed time) | Since `exchangeTenantId` is its own column, a native value equal to a branch's `legacyBranchId` causes no `@unique` clash; branch ids never key the tenant counter; migration is final so no late collision. |
| **Allocator** | Single-row `PlatformCounter` incremented via Prisma `update({ increment: 1 })` inside the create transaction | Mirrors existing per-tenant counters (`branchCounter`, `orderCounter`); pure Prisma, no request-path raw SQL; row lock serialises concurrent creates. |

`exchangeTenantId` is the value sent to the exchange for **every** tenant:
- migrated tenant → `exchangeTenantId = legacyTenantId`
- native tenant → allocator value

---

## 3a. Preconditions & verification (rollout gate)

The ID strategy guarantees we **send** the right integer, but count
*preservation* depends on two facts that live on the **exchange server**, not in
our code. Rollout (§6) must not proceed until both are confirmed.

Evidence: the envelope carries a single **global** `key`/`secret`
(`configuration.ts:26`), and the credentials differ across stacks — legacy
EzHealthTrack sent under **`nwrlab_ezhealthtrack_com`** (`params.jaipur.php:129`)
while the kishan/business lineage uses **`business_ezhealthtrack_com`**
(`kishan .env:70`). If the exchange partitions counts per API key/app, the same
`peer_tenant_id` under a different credential is a **new** counter.

| # | Condition to confirm | Owner |
| --- | --- | --- |
| P1 | Counts are keyed on `peer_tenant_id` **alone** — independent of API key/app and `peer_server_url`. | Exchange server owner |
| P2 | kalnostics-new sends under the **same credential + prod host** the historical counts for these tenants live under. | Us (env config) + exchange owner |

**Live verification (settle empirically before full rollout):** point staging at
the prod exchange with the intended credential, send one message for a single
known migrated tenant, and confirm the exchange **increments that tenant's
existing total** rather than starting at 1. If it starts at 1, P1/P2 are not
satisfied and the credential/host must be corrected first.

---

## 4. Schema changes

`prisma/schema.prisma`:

```prisma
model Tenant {
  // ...
  legacyTenantId   Int? @unique @map("legacy_tenant_id") // unchanged — history only
  exchangeTenantId Int? @unique @map("exchange_tenant_id") // integer sent to Exchange
  // ...
}

/// Platform-level (no tenantId, no RLS) monotonic counters that span all
/// tenants. One row per logical sequence, keyed by `key`.
model PlatformCounter {
  key       String   @id                         // e.g. "exchange_tenant_id"
  value     Int      @default(0)                  // last-assigned value (high-water mark)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("platform_counters")
}
```

- `exchangeTenantId` is **nullable** during rollout (existing rows start `NULL`,
  then get backfilled); the `@unique` constraint is the correctness backstop.
- `PlatformCounter` gets **no RLS policy** (platform-level, like `tenants`).
- Ships as a committed migration (datamodel `migrate diff` + no RLS addition),
  per the always-create-a-migration rule.

---

## 5. Allocator

A single `PlatformCounter` row with `key = "exchange_tenant_id"`. `value` holds
the **last assigned** id (high-water mark); allocation returns `value + 1`.

**Atomic allocation (inside a transaction):**

```ts
const { value } = await tx.platformCounter.update({
  where: { key: 'exchange_tenant_id' },
  data: { value: { increment: 1 } },
  select: { value: true },
});
return value; // the newly-allocated exchangeTenantId
```

The `UPDATE` takes a row lock, so two concurrent tenant creates serialise and
receive distinct values. `Tenant.exchangeTenantId @unique` is the backstop.

**Monotonic seed (idempotent):** the counter is seeded/advanced to
`GREATEST(current value, MAX(exchangeTenantId), MAX(legacyTenantId))`. It only
ever moves **up**, so re-running seeding is a no-op.

---

## 6. Production rollout runbook (one-time, ordered, idempotent)

1. **Deploy schema migration** (adds `exchangeTenantId`, `PlatformCounter`;
   inserts the `exchange_tenant_id` counter row at `value = 0`). Existing rows
   unaffected (`exchangeTenantId = NULL`).
2. **Run `pnpm migrate:ezht`** for every legacy `BUSINESS_ID` (already
   idempotent — skips via `legacyTenantId`). Each migrated tenant is created
   with `legacyTenantId` set; the create path (see §7) also sets
   `exchangeTenantId = legacyTenantId`.
3. **Run the backfill sync** `pnpm sync:tenant-exchange-id` (see §8). Seeds the
   counter, then assigns ids to any tenant with `exchangeTenantId IS NULL`.
4. **Verify:** every `Tenant` has a non-null unique `exchangeTenantId`; all
   migrated tenants' ids equal their `legacyTenantId` (unchanged); counter
   `value = MAX(exchangeTenantId)`.

Native tenant creation must not be opened to users until steps 2–3 complete
(constraint §2.3).

---

## 7. Runtime — future tenant creation

Inside the existing `create()` `$transaction` (`tenant.service.ts:224`), decide
`exchangeTenantId` before `tx.tenant.create`:

- **Migrated path** (`options.legacyTenantId != null`, i.e. `migrate:ezht`):
  `exchangeTenantId = legacyTenantId`. Also advance the counter defensively:
  `value = GREATEST(value, legacyTenantId)` — keeps the high-water mark correct
  even if a stray migration runs after go-live.
- **Native path** (no `legacyTenantId`): allocate via the counter (§5).

Set `exchangeTenantId` in the same `tx.tenant.create({ data: { ... } })` call, so
tenant + id are atomic. No client input is ever accepted for this field.

---

## 8. Backfill sync (`pnpm sync:tenant-exchange-id`)

Standalone script (mirrors `migrate:ezht` via a Nest standalone context),
runnable any number of times. Also exposable later as a SiteAdmin endpoint;
script is sufficient for the one-time prod need.

Algorithm, in one `$transaction`:

1. `maxLegacy   = MAX(Tenant.legacyTenantId)` (or 0)
2. `maxExchange = MAX(Tenant.exchangeTenantId)` (or 0)
3. `counter     = platformCounter.value`
4. `floor = GREATEST(counter, maxLegacy, maxExchange)`; set
   `platformCounter.value = floor` (monotonic — never lowers).
5. **Migrated-missing:** tenants with `exchangeTenantId IS NULL` **and**
   `legacyTenantId IS NOT NULL` (e.g. rows migrated before this feature existed)
   → set `exchangeTenantId = legacyTenantId` and bump the counter to it. Their
   id is never invented.
6. **Native-missing:** tenants with `exchangeTenantId IS NULL` **and**
   `legacyTenantId IS NULL`, ordered deterministically (`createdAt ASC, id ASC`)
   → for each, atomically `increment` the counter and set the returned value.

**Idempotency:** touches only `NULL` rows; existing ids are never read-modified;
counter only rises. A second run assigns nothing.

---

## 9. Dispatch change (`communication.service.ts`)

`dispatch()` builds `peer` from `row.tenantId` (UUID). Change `peer.tenantId` to
the tenant's **`exchangeTenantId`**:

- Resolve `exchangeTenantId` for `row.tenantId` (lookup on the platform-level
  `Tenant` table — no RLS concern; small in-memory cache acceptable since the
  worker drains many rows).
- If it is `NULL` (should not happen post-backfill): **do not** fall back to the
  UUID. Log an error and let the row fail/retry, so a mis-keyed count is never
  sent.
- `peer_branch_id` handling is unchanged for now (exchange keys tenant-only);
  optionally send `legacyBranchId` later — out of scope here.

---

## 10. Edge cases & failure modes

- **Concurrent native creates:** serialised by the counter row lock;
  `@unique` backstops.
- **Re-running `migrate:ezht`:** idempotent; migrated ids never change.
- **Re-running the sync:** no-op (only fills `NULL`s; counter monotonic).
- **Straggler legacy import after go-live** (not expected — migration final):
  migrated path sets `exchangeTenantId = legacyTenantId` and bumps the counter;
  a pre-existing native tenant already holding that number would surface as a
  `@unique` violation — a loud, correct signal rather than silent count
  pollution.
- **Tenant with `exchangeTenantId = NULL` at dispatch:** send is blocked and
  logged (§9).

---

## 11. Testing

- **Unit** — allocator returns strictly increasing values; monotonic seed never
  lowers; migrated path preserves `legacyTenantId`.
- **Concurrency** — N parallel `create()` calls yield N distinct
  `exchangeTenantId`s (no dupes, no gaps beyond the expected increments).
- **Idempotency** — run sync twice; assert no changes on the second run.
- **Dispatch** — envelope carries the integer `exchangeTenantId`, not the UUID;
  `NULL` id blocks the send.

---

## 12. Rollback

- Schema is additive (new nullable column + new table) — safe to leave in place.
- If dispatch must revert, restore `peer.tenantId = row.tenantId`; the
  `exchangeTenantId` data remains valid for a later retry.

---

## 13. Out of scope

- Sending `legacyBranchId` as `peer_branch_id`.
- Exposing the backfill as a SiteAdmin API (script suffices for the one-time
  need; can be added later).
