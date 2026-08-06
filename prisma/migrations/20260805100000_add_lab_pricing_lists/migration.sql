-- Lab Pricing Lists: branches keep multiple named pricing Lists (Walk-in default).
-- Each list owns full copies of its rows (BranchLabTest/Panel gain list_id + list_price);
-- referrals map to lists per branch (ReferralListAssignment) replacing the 8 individual
-- test/panel junctions; orders record the chosen lists + snapshot each item's unit price.

-- CreateEnum
CREATE TYPE "ListPriceType" AS ENUM ('PERCENTAGE', 'CUSTOMIZED');
CREATE TYPE "ListPriceSource" AS ENUM ('MSRP', 'MAXIMUM', 'MINIMUM', 'ORIGINAL', 'FRANCHISE');
CREATE TYPE "ReferralType" AS ENUM ('PANEL', 'DOCTOR', 'INTERNAL', 'EXTERNAL');

-- DropTable: individual per-referral test/panel assignments are replaced by per-branch
-- list assignments (ReferralListAssignment). Dev env — no data migration.
DROP TABLE IF EXISTS "referral_panel_lab_tests";
DROP TABLE IF EXISTS "referral_panel_lab_panels";
DROP TABLE IF EXISTS "referral_doctor_lab_tests";
DROP TABLE IF EXISTS "referral_doctor_lab_panels";
DROP TABLE IF EXISTS "external_referral_lab_tests";
DROP TABLE IF EXISTS "external_referral_lab_panels";
DROP TABLE IF EXISTS "internal_referral_lab_tests";
DROP TABLE IF EXISTS "internal_referral_lab_panels";

-- AlterTable: pricing-list membership + effective list price on branch catalogue rows.
ALTER TABLE "branch_lab_tests"
  ADD COLUMN "list_id" TEXT,
  ADD COLUMN "list_price" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "branch_lab_panels"
  ADD COLUMN "list_id" TEXT,
  ADD COLUMN "list_price" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: order records the resolved pricing lists; items snapshot their unit price.
ALTER TABLE "orders"
  ADD COLUMN "branch_lab_test_list_id" TEXT,
  ADD COLUMN "branch_lab_panel_list_id" TEXT;
ALTER TABLE "order_items"
  ADD COLUMN "unit_price" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "branch_lab_test_lists" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "price_type" "ListPriceType" NOT NULL DEFAULT 'CUSTOMIZED',
    "copy_price_from" "ListPriceSource",
    "copy_percentage" INTEGER,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "branch_lab_test_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_lab_panel_lists" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "price_type" "ListPriceType" NOT NULL DEFAULT 'CUSTOMIZED',
    "copy_price_from" "ListPriceSource",
    "copy_percentage" INTEGER,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "branch_lab_panel_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_list_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "referral_type" "ReferralType" NOT NULL,
    "referral_id" TEXT NOT NULL,
    "branch_lab_test_list_id" TEXT,
    "branch_lab_panel_list_id" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "referral_list_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_lab_test_lists_tenant_id_idx" ON "branch_lab_test_lists"("tenant_id");
CREATE INDEX "branch_lab_test_lists_branch_id_idx" ON "branch_lab_test_lists"("branch_id");
CREATE INDEX "branch_lab_test_lists_deleted_at_idx" ON "branch_lab_test_lists"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_lab_panel_lists_tenant_id_idx" ON "branch_lab_panel_lists"("tenant_id");
CREATE INDEX "branch_lab_panel_lists_branch_id_idx" ON "branch_lab_panel_lists"("branch_id");
CREATE INDEX "branch_lab_panel_lists_deleted_at_idx" ON "branch_lab_panel_lists"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_list_assignments_tenant_id_idx" ON "referral_list_assignments"("tenant_id");
CREATE INDEX "referral_list_assignments_branch_id_idx" ON "referral_list_assignments"("branch_id");
CREATE UNIQUE INDEX "referral_list_assignments_referral_type_referral_id_branch__key" ON "referral_list_assignments"("referral_type", "referral_id", "branch_id");

-- CreateIndex
CREATE INDEX "branch_lab_tests_list_id_idx" ON "branch_lab_tests"("list_id");
CREATE INDEX "branch_lab_panels_list_id_idx" ON "branch_lab_panels"("list_id");

-- AddForeignKey
ALTER TABLE "branch_lab_tests" ADD CONSTRAINT "branch_lab_tests_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "branch_lab_test_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "branch_lab_panels" ADD CONSTRAINT "branch_lab_panels_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "branch_lab_panel_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Row-Level Security (mirrors prisma/rls.sql) ──────────────────────────────────
-- Runs after 1_row_level_security so current_tenant_id() already exists.

-- The "one default variant per source" partial-unique is now scoped PER LIST
-- (each pricing list owns its own default copy of a source test/panel).
DROP INDEX IF EXISTS "branch_lab_test_default_per_source_unique";
CREATE UNIQUE INDEX "branch_lab_test_default_per_source_unique"
  ON "branch_lab_tests" (tenant_id, branch_id, list_id, source_lab_test_id)
  WHERE is_default AND deleted_at IS NULL;
DROP INDEX IF EXISTS "branch_lab_panel_default_per_source_unique";
CREATE UNIQUE INDEX "branch_lab_panel_default_per_source_unique"
  ON "branch_lab_panels" (tenant_id, branch_id, list_id, source_lab_panel_id)
  WHERE is_default AND deleted_at IS NULL;

-- branch_lab_test_lists
ALTER TABLE "branch_lab_test_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branch_lab_test_lists" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_lab_test_lists_tenant_isolation ON "branch_lab_test_lists";
CREATE POLICY branch_lab_test_lists_tenant_isolation ON "branch_lab_test_lists"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX "branch_lab_test_list_name_active_unique"
  ON "branch_lab_test_lists" (tenant_id, branch_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX "branch_lab_test_list_default_active_unique"
  ON "branch_lab_test_lists" (tenant_id, branch_id) WHERE is_default AND deleted_at IS NULL;

-- branch_lab_panel_lists
ALTER TABLE "branch_lab_panel_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branch_lab_panel_lists" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_lab_panel_lists_tenant_isolation ON "branch_lab_panel_lists";
CREATE POLICY branch_lab_panel_lists_tenant_isolation ON "branch_lab_panel_lists"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE UNIQUE INDEX "branch_lab_panel_list_name_active_unique"
  ON "branch_lab_panel_lists" (tenant_id, branch_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX "branch_lab_panel_list_default_active_unique"
  ON "branch_lab_panel_lists" (tenant_id, branch_id) WHERE is_default AND deleted_at IS NULL;

-- referral_list_assignments
ALTER TABLE "referral_list_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referral_list_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rla_tenant_isolation ON "referral_list_assignments";
CREATE POLICY rla_tenant_isolation ON "referral_list_assignments"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
