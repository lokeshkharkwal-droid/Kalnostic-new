-- CreateEnum
CREATE TYPE "OrderNoteCategory" AS ENUM ('ORDER', 'SAMPLE', 'TECH');

-- CreateTable
CREATE TABLE "order_notes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "category" "OrderNoteCategory" NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_notes_tenant_id_idx" ON "order_notes"("tenant_id");

-- CreateIndex
CREATE INDEX "order_notes_branch_id_idx" ON "order_notes"("branch_id");

-- CreateIndex
CREATE INDEX "order_notes_order_id_idx" ON "order_notes"("order_id");

-- CreateIndex
CREATE INDEX "order_notes_category_idx" ON "order_notes"("category");

-- AddForeignKey
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security for the new order_notes table — mirrors the order_notes
-- block added to prisma/rls.sql. Tenant-isolation policy keyed on tenant_id
-- (CLAUDE.md §4.3). Idempotent (DROP IF EXISTS / FORCE), and runs after
-- 1_row_level_security so current_tenant_id() already exists.
ALTER TABLE order_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_notes_tenant_isolation ON order_notes;
CREATE POLICY order_notes_tenant_isolation ON order_notes
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
