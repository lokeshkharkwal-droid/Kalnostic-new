-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'MASTER_DATA';

-- CreateTable
CREATE TABLE "master_data" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "master_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_data_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "master_data_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "master_data_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "master_data_tenant_id_idx" ON "master_data"("tenant_id");

-- CreateIndex
CREATE INDEX "master_data_branch_id_idx" ON "master_data"("branch_id");

-- CreateIndex
CREATE INDEX "master_data_deleted_at_idx" ON "master_data"("deleted_at");

-- CreateIndex
CREATE INDEX "master_data_lab_tests_tenant_id_idx" ON "master_data_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "master_data_lab_tests_branch_id_idx" ON "master_data_lab_tests"("branch_id");

-- CreateIndex
CREATE INDEX "master_data_lab_tests_master_data_id_idx" ON "master_data_lab_tests"("master_data_id");

-- CreateIndex
CREATE INDEX "master_data_lab_tests_deleted_at_idx" ON "master_data_lab_tests"("deleted_at");
