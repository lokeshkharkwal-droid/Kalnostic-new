-- Duplicate-submission guard for POST /orders.
--
-- Why: on 2026-11-16 the Create Order screen sent the same submission twice
-- within ~200 ms (a double-click on Submit while the patient was still being
-- saved), and each request created its own order + payment rows (e.g.
-- DIAGNOSTICS-NIRMAL ORD-02869/02870, ORD-02871/02872, ORD-02875/02876). Nothing
-- on the server tied the two requests together.
--
-- The client now sends one `idempotencyKey` (UUID) per Create Order submission,
-- reused on every retry of that submission. The key is stored on the order it
-- created, unique per tenant, so a repeat request returns that order instead of
-- creating a new one. A concurrent repeat blocks on this unique index until the
-- first transaction commits, then fails with P2002, which OrderService.create
-- turns into the same replay.
--
-- Existing rows keep NULL; Postgres treats NULLs as distinct, so they (and any
-- caller that sends no key) are never constrained. Nothing in this migration can
-- fail on existing data.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "orders_tenant_id_idempotency_key_key"
  ON "orders" ("tenant_id", "idempotency_key");
