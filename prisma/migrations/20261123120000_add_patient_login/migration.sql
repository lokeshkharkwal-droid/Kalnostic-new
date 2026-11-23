-- Patient Login (patient-portal auth). Reuses the existing platform-level
-- `person_credentials`, `persons` and `refresh_tokens` tables — NO new credential
-- table. Two additive changes only:
--
--  1. refresh_tokens: distinguish patient refresh tokens from business ones
--     (`token_type`) and remember the patient's selected tenant for the
--     "login then pick business" flow (`tenant_id`). Both are additive; every
--     existing row defaults to the `business` audience with no tenant, so no
--     backfill is needed.
--  2. person_tenant_enrollments.branch_id becomes NULLABLE: this previously-unused
--     table is now the platform-level (RLS-exempt) index that patient login reads
--     to list a person's tenants without touching the RLS-scoped `patients` table.
--     A patient enrolled for portal access may be tenant-level (no branch).
--
-- All three tables are platform-level (see prisma/rls.sql) — no RLS policy changes.

-- AlterTable: refresh_tokens
ALTER TABLE "refresh_tokens" ADD COLUMN "token_type" TEXT NOT NULL DEFAULT 'business';
ALTER TABLE "refresh_tokens" ADD COLUMN "tenant_id" TEXT;

-- CreateIndex
CREATE INDEX "refresh_tokens_tenant_id_idx" ON "refresh_tokens"("tenant_id");

-- AlterTable: person_tenant_enrollments.branch_id -> nullable
ALTER TABLE "person_tenant_enrollments" ALTER COLUMN "branch_id" DROP NOT NULL;
