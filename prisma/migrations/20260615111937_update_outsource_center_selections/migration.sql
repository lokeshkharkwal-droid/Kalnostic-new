/*
  Warnings:

  - You are about to drop the column `lab_panel_list_id` on the `outsource_center_branch_assignments` table. All the data in the column will be lost.
  - You are about to drop the column `lab_test_list_id` on the `outsource_center_branch_assignments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "outsource_center_branch_assignments" DROP COLUMN "lab_panel_list_id",
DROP COLUMN "lab_test_list_id";

-- CreateTable
CREATE TABLE "outsource_center_branch_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "outsource_center_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outsource_center_branch_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outsource_center_branch_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "outsource_center_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "lab_panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outsource_center_branch_panels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outsource_center_branch_tests_tenant_id_idx" ON "outsource_center_branch_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_tests_branch_id_idx" ON "outsource_center_branch_tests"("branch_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_tests_outsource_center_id_idx" ON "outsource_center_branch_tests"("outsource_center_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_tests_assignment_id_idx" ON "outsource_center_branch_tests"("assignment_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_tests_lab_test_id_idx" ON "outsource_center_branch_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_tests_deleted_at_idx" ON "outsource_center_branch_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "outsource_center_branch_panels_tenant_id_idx" ON "outsource_center_branch_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_panels_branch_id_idx" ON "outsource_center_branch_panels"("branch_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_panels_outsource_center_id_idx" ON "outsource_center_branch_panels"("outsource_center_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_panels_assignment_id_idx" ON "outsource_center_branch_panels"("assignment_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_panels_lab_panel_id_idx" ON "outsource_center_branch_panels"("lab_panel_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_panels_deleted_at_idx" ON "outsource_center_branch_panels"("deleted_at");

-- AddForeignKey
ALTER TABLE "outsource_center_branch_tests" ADD CONSTRAINT "outsource_center_branch_tests_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "outsource_center_branch_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outsource_center_branch_panels" ADD CONSTRAINT "outsource_center_branch_panels_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "outsource_center_branch_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
