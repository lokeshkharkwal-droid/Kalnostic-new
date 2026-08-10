-- PT Category redesign: map a PT Category to a Lab Test List + Lab Panel List
-- (branch_lab_test_lists / branch_lab_panel_lists) instead of individual branch
-- Lab Test / Lab Panel rows — mirroring how referrals map to pricing lists.
-- Dev env — no data migration (only test rows).

-- Drop the old item-based mapping (FKs, indexes, columns).
ALTER TABLE "pt_categories" DROP CONSTRAINT IF EXISTS "pt_categories_lab_test_id_fkey";
ALTER TABLE "pt_categories" DROP CONSTRAINT IF EXISTS "pt_categories_lab_panel_id_fkey";
DROP INDEX IF EXISTS "pt_categories_lab_test_id_idx";
DROP INDEX IF EXISTS "pt_categories_lab_panel_id_idx";
ALTER TABLE "pt_categories" DROP COLUMN IF EXISTS "lab_test_id";
ALTER TABLE "pt_categories" DROP COLUMN IF EXISTS "lab_panel_id";

-- Add the list-based mapping.
ALTER TABLE "pt_categories"
  ADD COLUMN "branch_lab_test_list_id" TEXT,
  ADD COLUMN "branch_lab_panel_list_id" TEXT;

-- CreateIndex
CREATE INDEX "pt_categories_branch_lab_test_list_id_idx" ON "pt_categories"("branch_lab_test_list_id");
CREATE INDEX "pt_categories_branch_lab_panel_list_id_idx" ON "pt_categories"("branch_lab_panel_list_id");

-- AddForeignKey
ALTER TABLE "pt_categories" ADD CONSTRAINT "pt_categories_branch_lab_test_list_id_fkey" FOREIGN KEY ("branch_lab_test_list_id") REFERENCES "branch_lab_test_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pt_categories" ADD CONSTRAINT "pt_categories_branch_lab_panel_list_id_fkey" FOREIGN KEY ("branch_lab_panel_list_id") REFERENCES "branch_lab_panel_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
