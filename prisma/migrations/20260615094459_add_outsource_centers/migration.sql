-- CreateEnum
CREATE TYPE "OutsourceContactRole" AS ENUM ('DIRECTOR', 'ACCESSION_PERSON', 'REGISTRATION_PERSON', 'LOGISTICS_PERSON', 'ACCOUNTS_PERSON');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'OUTSOURCE_CENTER';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "outsource_center_counter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "outsource_centers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "outsource_center_name" TEXT NOT NULL,
    "short_name" TEXT,
    "address" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "pincode" TEXT,
    "gst_number" TEXT,
    "pan_number" TEXT,
    "account_holder_name" TEXT,
    "bank_name" TEXT,
    "bank_account_number" TEXT,
    "ifsc_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outsource_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outsource_center_contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "outsource_center_id" TEXT NOT NULL,
    "role" "OutsourceContactRole" NOT NULL,
    "name" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outsource_center_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outsource_center_branch_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "outsource_center_id" TEXT NOT NULL,
    "lab_test_list_id" TEXT,
    "lab_panel_list_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outsource_center_branch_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outsource_centers_tenant_id_idx" ON "outsource_centers"("tenant_id");

-- CreateIndex
CREATE INDEX "outsource_centers_deleted_at_idx" ON "outsource_centers"("deleted_at");

-- CreateIndex
CREATE INDEX "outsource_center_contacts_tenant_id_idx" ON "outsource_center_contacts"("tenant_id");

-- CreateIndex
CREATE INDEX "outsource_center_contacts_outsource_center_id_idx" ON "outsource_center_contacts"("outsource_center_id");

-- CreateIndex
CREATE INDEX "outsource_center_contacts_deleted_at_idx" ON "outsource_center_contacts"("deleted_at");

-- CreateIndex
CREATE INDEX "outsource_center_branch_assignments_tenant_id_idx" ON "outsource_center_branch_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_assignments_branch_id_idx" ON "outsource_center_branch_assignments"("branch_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_assignments_outsource_center_id_idx" ON "outsource_center_branch_assignments"("outsource_center_id");

-- CreateIndex
CREATE INDEX "outsource_center_branch_assignments_deleted_at_idx" ON "outsource_center_branch_assignments"("deleted_at");

-- AddForeignKey
ALTER TABLE "outsource_center_contacts" ADD CONSTRAINT "outsource_center_contacts_outsource_center_id_fkey" FOREIGN KEY ("outsource_center_id") REFERENCES "outsource_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outsource_center_branch_assignments" ADD CONSTRAINT "outsource_center_branch_assignments_outsource_center_id_fkey" FOREIGN KEY ("outsource_center_id") REFERENCES "outsource_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
