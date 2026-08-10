-- PT (Patient) Categories for the Registration Settings page. A simple
-- one-to-one pricing mapping: each category points at (at most) one branch
-- Lab Test and one branch Lab Panel. Tenant-scoped + branch-level; a "General"
-- default is auto-created per branch on branch creation. Order creation resolves
-- a selected PT category to its mapped items' pricing lists (priority slot 2,
-- after B2B Panel).

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'PT_CATEGORY';

-- CreateTable
CREATE TABLE "pt_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "lab_test_id" TEXT,
    "lab_panel_id" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "pt_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pt_categories_tenant_id_idx" ON "pt_categories"("tenant_id");
CREATE INDEX "pt_categories_branch_id_idx" ON "pt_categories"("branch_id");
CREATE INDEX "pt_categories_lab_test_id_idx" ON "pt_categories"("lab_test_id");
CREATE INDEX "pt_categories_lab_panel_id_idx" ON "pt_categories"("lab_panel_id");
CREATE INDEX "pt_categories_deleted_at_idx" ON "pt_categories"("deleted_at");

-- AddForeignKey
ALTER TABLE "pt_categories" ADD CONSTRAINT "pt_categories_lab_test_id_fkey" FOREIGN KEY ("lab_test_id") REFERENCES "branch_lab_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pt_categories" ADD CONSTRAINT "pt_categories_lab_panel_id_fkey" FOREIGN KEY ("lab_panel_id") REFERENCES "branch_lab_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Row-Level Security (mirrors prisma/rls.sql) ──────────────────────────────────
-- Runs after 1_row_level_security so current_tenant_id() already exists.
ALTER TABLE "pt_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pt_categories" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pt_categories_tenant_isolation ON "pt_categories";
CREATE POLICY pt_categories_tenant_isolation ON "pt_categories"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Category name unique per branch among ACTIVE rows (soft-delete-aware).
CREATE UNIQUE INDEX "pt_categories_branch_name_active_unique"
  ON "pt_categories" (tenant_id, branch_id, category_name) WHERE deleted_at IS NULL;

-- At most one default PT category per branch among ACTIVE rows.
CREATE UNIQUE INDEX "pt_categories_branch_default_active_unique"
  ON "pt_categories" (tenant_id, branch_id) WHERE is_default AND deleted_at IS NULL;
