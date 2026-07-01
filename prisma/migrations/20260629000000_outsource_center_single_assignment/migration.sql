-- Collapse the per-branch outsource-center assignment model to a single lab test +
-- single lab panel directly on the center, and add a NABL-accreditation flag.
-- The per-branch assignment tables are dropped. `lab_test_id` / `lab_panel_id` are
-- nullable logical refs to a LabTest / LabPanel (validated in OutsourceCenterService;
-- no FK, mirroring lab_panel_tests.lab_test_id). Their @@index lives below; the RLS
-- policies for the dropped tables were removed from prisma/rls.sql.

-- DropForeignKey
ALTER TABLE "outsource_center_branch_assignments" DROP CONSTRAINT "outsource_center_branch_assignments_outsource_center_id_fkey";
-- DropForeignKey
ALTER TABLE "outsource_center_branch_panels" DROP CONSTRAINT "outsource_center_branch_panels_assignment_id_fkey";
-- DropForeignKey
ALTER TABLE "outsource_center_branch_tests" DROP CONSTRAINT "outsource_center_branch_tests_assignment_id_fkey";

-- AlterTable
ALTER TABLE "outsource_centers" ADD COLUMN     "is_nabl_accredited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lab_panel_id" TEXT,
ADD COLUMN     "lab_test_id" TEXT;

-- DropTable
DROP TABLE "outsource_center_branch_assignments";
-- DropTable
DROP TABLE "outsource_center_branch_panels";
-- DropTable
DROP TABLE "outsource_center_branch_tests";

-- CreateIndex
CREATE INDEX "outsource_centers_lab_test_id_idx" ON "outsource_centers"("lab_test_id");
-- CreateIndex
CREATE INDEX "outsource_centers_lab_panel_id_idx" ON "outsource_centers"("lab_panel_id");
