-- CreateEnum
CREATE TYPE "AgeGroup" AS ENUM ('ALL', 'ADULT', 'PEDIATRIC', 'SENIOR');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('COMBINED', 'SEPARATE');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'LAB_PANEL';

-- CreateTable
CREATE TABLE "lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "master_data_id" TEXT NOT NULL,
    "banner_image" TEXT,
    "panel_name" TEXT NOT NULL,
    "panel_code" TEXT NOT NULL,
    "category_id" TEXT,
    "department_id" TEXT,
    "applicable_gender" "ReferenceGender" NOT NULL DEFAULT 'ALL',
    "applicable_age_group" "AgeGroup" NOT NULL DEFAULT 'ALL',
    "report_type" "ReportType" NOT NULL DEFAULT 'COMBINED',
    "turnaround_priority" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "price_msrp" INTEGER NOT NULL DEFAULT 0,
    "price_minimum" INTEGER NOT NULL DEFAULT 0,
    "price_maximum" INTEGER NOT NULL DEFAULT 0,
    "price_original" INTEGER NOT NULL DEFAULT 0,
    "franchise_price" INTEGER NOT NULL DEFAULT 0,
    "tat_min_value" INTEGER,
    "tat_min_unit" "TatUnit" DEFAULT 'HOURS',
    "tat_max_value" INTEGER,
    "tat_max_unit" "TatUnit" DEFAULT 'HOURS',
    "panel_instructions" TEXT,
    "is_disable_discount" BOOLEAN NOT NULL DEFAULT false,
    "is_enable_cms" BOOLEAN NOT NULL DEFAULT true,
    "is_preference" BOOLEAN NOT NULL DEFAULT false,
    "is_fasting_required" BOOLEAN NOT NULL DEFAULT false,
    "is_show_online_booking" BOOLEAN NOT NULL DEFAULT true,
    "is_home_collection" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_partial_billing" BOOLEAN NOT NULL DEFAULT false,
    "max_tests_removable" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_panel_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "lab_panel_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_removable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_panel_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_panels_tenant_id_idx" ON "lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_panels_branch_id_idx" ON "lab_panels"("branch_id");

-- CreateIndex
CREATE INDEX "lab_panels_master_data_id_idx" ON "lab_panels"("master_data_id");

-- CreateIndex
CREATE INDEX "lab_panels_department_id_idx" ON "lab_panels"("department_id");

-- CreateIndex
CREATE INDEX "lab_panels_category_id_idx" ON "lab_panels"("category_id");

-- CreateIndex
CREATE INDEX "lab_panels_is_active_idx" ON "lab_panels"("is_active");

-- CreateIndex
CREATE INDEX "lab_panels_deleted_at_idx" ON "lab_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_panel_tests_tenant_id_idx" ON "lab_panel_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_panel_tests_branch_id_idx" ON "lab_panel_tests"("branch_id");

-- CreateIndex
CREATE INDEX "lab_panel_tests_lab_panel_id_idx" ON "lab_panel_tests"("lab_panel_id");

-- CreateIndex
CREATE INDEX "lab_panel_tests_lab_panel_id_sort_order_idx" ON "lab_panel_tests"("lab_panel_id", "sort_order");

-- CreateIndex
CREATE INDEX "lab_panel_tests_lab_test_id_idx" ON "lab_panel_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_panel_tests_deleted_at_idx" ON "lab_panel_tests"("deleted_at");
