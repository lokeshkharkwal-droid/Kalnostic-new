-- Per-user default date filter for list screens (Registration Billings, Finance
-- Billings, Registration Order Console). Personal UI preference: one row per
-- (tenant, person, screen). Tenant-scoped (RLS below); `preset` is a relative
-- range resolved at open time, only CUSTOM stores fixed dates.

-- CreateTable
CREATE TABLE "user_date_filter_preferences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "screen_key" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "date_from" DATE,
    "date_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "user_date_filter_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_date_filter_preferences_tenant_id_idx" ON "user_date_filter_preferences"("tenant_id");
CREATE INDEX "user_date_filter_preferences_person_id_idx" ON "user_date_filter_preferences"("person_id");
CREATE UNIQUE INDEX "user_date_filter_preferences_tenant_id_person_id_screen_key_key" ON "user_date_filter_preferences"("tenant_id", "person_id", "screen_key");

-- ── Row-Level Security (mirrors prisma/rls.sql) ──────────────────────────────────
-- Runs after 1_row_level_security so current_tenant_id() already exists.
ALTER TABLE "user_date_filter_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_date_filter_preferences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_date_filter_preferences_tenant_isolation ON "user_date_filter_preferences";
CREATE POLICY user_date_filter_preferences_tenant_isolation ON "user_date_filter_preferences"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
