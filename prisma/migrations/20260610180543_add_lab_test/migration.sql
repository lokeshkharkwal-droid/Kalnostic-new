/*
  Warnings:

  - You are about to drop the `master_data_lab_tests` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ProcessMethod" AS ENUM ('SINGLE_STEP', 'MULTI_STEP');

-- CreateEnum
CREATE TYPE "SamplePriority" AS ENUM ('ROUTINE', 'URGENT', 'STAT');

-- CreateEnum
CREATE TYPE "TatUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS');

-- CreateEnum
CREATE TYPE "RepeatIntervalUnit" AS ENUM ('HOURS', 'DAYS', 'MONTHS', 'YEARS');

-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('QUANTITATIVE', 'QUALITATIVE', 'CALCULATED');

-- CreateEnum
CREATE TYPE "ParameterType" AS ENUM ('MEASURED', 'CALCULATED');

-- CreateEnum
CREATE TYPE "ResultEntryMode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "ResultRounding" AS ENUM ('NO_ROUNDING', 'ONE_DECIMAL', 'TWO_DECIMAL', 'THREE_DECIMAL', 'WHOLE_NUMBER');

-- CreateEnum
CREATE TYPE "ReferenceGender" AS ENUM ('ALL', 'MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "AgeUnit" AS ENUM ('DAYS', 'MONTHS', 'YEARS');

-- CreateEnum
CREATE TYPE "AbnormalFlag" AS ENUM ('BOLD_AND_RED', 'BOLD_ONLY', 'ITALIC', 'UNDERLINE', 'COLOUR_HIGHLIGHT');

-- CreateEnum
CREATE TYPE "ContainerType" AS ENUM ('EDTA_TUBE_PURPLE_TOP', 'PLAIN_TUBE_RED_TOP', 'FLUORIDE_TUBE_GREY_TOP', 'URINE_CONTAINER', 'STERILE_CONTAINER');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'LAB_TEST';

-- DropTable
DROP TABLE "master_data_lab_tests";

-- CreateTable
CREATE TABLE "lab_test" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "master_data_id" TEXT NOT NULL,
    "test_name" TEXT NOT NULL,
    "test_display_name" TEXT,
    "test_code" TEXT NOT NULL,
    "aka" TEXT,
    "department_id" TEXT,
    "category_id" TEXT,
    "sub_category_id" TEXT,
    "process_method" "ProcessMethod" NOT NULL DEFAULT 'SINGLE_STEP',
    "icd_code" TEXT,
    "loinc_code" TEXT,
    "clinical_tags" TEXT[],
    "report_template_id" TEXT,
    "sample_priority_type" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "pdf_settings_id" TEXT,
    "image_settings_id" TEXT,
    "is_enable_cms" BOOLEAN NOT NULL DEFAULT true,
    "approval_workflow_id" TEXT,
    "price_msrp" INTEGER NOT NULL DEFAULT 0,
    "price_maximum" INTEGER NOT NULL DEFAULT 0,
    "price_minimum" INTEGER NOT NULL DEFAULT 0,
    "price_original" INTEGER NOT NULL DEFAULT 0,
    "franchise_price" INTEGER NOT NULL DEFAULT 0,
    "emergency_price" INTEGER NOT NULL DEFAULT 0,
    "discount_cap_pct" INTEGER NOT NULL DEFAULT 0,
    "is_allow_price_override" BOOLEAN NOT NULL DEFAULT false,
    "tat_min_value" INTEGER,
    "tat_min_unit" "TatUnit",
    "tat_max_value" INTEGER,
    "tat_max_unit" "TatUnit",
    "schedule_days" "DayOfWeek"[],
    "schedule_from" TEXT,
    "schedule_to" TEXT,
    "proc_time_min_value" INTEGER,
    "proc_time_min_unit" "TatUnit",
    "proc_time_max_value" INTEGER,
    "proc_time_max_unit" "TatUnit",
    "approval_time_from" TEXT,
    "approval_time_to" TEXT,
    "is_hide_in_order_screen" BOOLEAN NOT NULL DEFAULT false,
    "is_preference_test" BOOLEAN NOT NULL DEFAULT false,
    "is_mandatory_test" BOOLEAN NOT NULL DEFAULT false,
    "mandatory_dept_id" TEXT,
    "mandatory_cat_id" TEXT,
    "mandatory_subcat_id" TEXT,
    "is_repeat_interval_restriction" BOOLEAN NOT NULL DEFAULT false,
    "repeat_interval_value" INTEGER,
    "repeat_interval_unit" "RepeatIntervalUnit",
    "useful_for" TEXT,
    "interpretation_of_results" TEXT,
    "limitations" TEXT,
    "remarks" TEXT,
    "references" TEXT,
    "version_history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_test_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_samples" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "sample_name_id" TEXT,
    "container_type" "ContainerType",
    "sample_size" TEXT,
    "collection_method" TEXT,
    "number_of_samples" INTEGER NOT NULL DEFAULT 1,
    "stability" TEXT,
    "transport_temperature" TEXT,
    "preservative" TEXT,
    "sample_handling_instructions" TEXT,
    "is_fasting_required" BOOLEAN NOT NULL DEFAULT false,
    "is_light_protection" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_test_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_result_params" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "group_name" TEXT,
    "group_layout_id" TEXT,
    "group_settings_id" TEXT,
    "parameter_name" TEXT NOT NULL,
    "parameter_code" TEXT NOT NULL,
    "method" TEXT,
    "attach_file_url" TEXT,
    "icon_settings_id" TEXT,
    "reporting_unit" TEXT,
    "result_type" "ResultType" NOT NULL,
    "parameter_type" "ParameterType" NOT NULL DEFAULT 'MEASURED',
    "result_entry_mode" "ResultEntryMode" NOT NULL DEFAULT 'MANUAL',
    "calculation_formula" TEXT,
    "result_rounding_type" "ResultRounding" NOT NULL DEFAULT 'TWO_DECIMAL',
    "allowable_units" TEXT,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "reflex_test_ids" TEXT[],
    "notes" TEXT,
    "is_nabl" BOOLEAN NOT NULL DEFAULT false,
    "is_cap" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_test_result_params_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_reference_ranges" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "param_id" TEXT NOT NULL,
    "method" TEXT,
    "gender" "ReferenceGender" NOT NULL DEFAULT 'ALL',
    "age_from" INTEGER NOT NULL DEFAULT 0,
    "age_from_unit" "AgeUnit" NOT NULL DEFAULT 'YEARS',
    "age_to" INTEGER NOT NULL DEFAULT 999,
    "age_to_unit" "AgeUnit" NOT NULL DEFAULT 'YEARS',
    "lower_limit" DECIMAL(10,4),
    "upper_limit" DECIMAL(10,4),
    "critical_min" DECIMAL(10,4),
    "critical_max" DECIMAL(10,4),
    "display_of_reference_range" TEXT,
    "abnormal_flag_logic" "AbnormalFlag" NOT NULL DEFAULT 'BOLD_AND_RED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_test_reference_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_reference_values" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "param_id" TEXT NOT NULL,
    "method" TEXT,
    "gender" "ReferenceGender" NOT NULL DEFAULT 'ALL',
    "age_from" INTEGER NOT NULL DEFAULT 0,
    "age_from_unit" "AgeUnit" NOT NULL DEFAULT 'YEARS',
    "age_to" INTEGER NOT NULL DEFAULT 999,
    "age_to_unit" "AgeUnit" NOT NULL DEFAULT 'YEARS',
    "normal_value_text" TEXT NOT NULL,
    "display_of_reference_range" TEXT,
    "abnormal_flag_logic" "AbnormalFlag" NOT NULL DEFAULT 'BOLD_AND_RED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lab_test_reference_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_test_tenant_id_idx" ON "lab_test"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_branch_id_idx" ON "lab_test"("branch_id");

-- CreateIndex
CREATE INDEX "lab_test_master_data_id_idx" ON "lab_test"("master_data_id");

-- CreateIndex
CREATE INDEX "lab_test_department_id_idx" ON "lab_test"("department_id");

-- CreateIndex
CREATE INDEX "lab_test_category_id_idx" ON "lab_test"("category_id");

-- CreateIndex
CREATE INDEX "lab_test_deleted_at_idx" ON "lab_test"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_test_samples_tenant_id_idx" ON "lab_test_samples"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_samples_branch_id_idx" ON "lab_test_samples"("branch_id");

-- CreateIndex
CREATE INDEX "lab_test_samples_lab_test_id_idx" ON "lab_test_samples"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_test_samples_deleted_at_idx" ON "lab_test_samples"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_test_result_params_tenant_id_idx" ON "lab_test_result_params"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_result_params_branch_id_idx" ON "lab_test_result_params"("branch_id");

-- CreateIndex
CREATE INDEX "lab_test_result_params_lab_test_id_idx" ON "lab_test_result_params"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_test_result_params_lab_test_id_sort_order_idx" ON "lab_test_result_params"("lab_test_id", "sort_order");

-- CreateIndex
CREATE INDEX "lab_test_result_params_deleted_at_idx" ON "lab_test_result_params"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_test_reference_ranges_tenant_id_idx" ON "lab_test_reference_ranges"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_ranges_branch_id_idx" ON "lab_test_reference_ranges"("branch_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_ranges_lab_test_id_idx" ON "lab_test_reference_ranges"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_ranges_param_id_idx" ON "lab_test_reference_ranges"("param_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_ranges_deleted_at_idx" ON "lab_test_reference_ranges"("deleted_at");

-- CreateIndex
CREATE INDEX "lab_test_reference_values_tenant_id_idx" ON "lab_test_reference_values"("tenant_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_values_branch_id_idx" ON "lab_test_reference_values"("branch_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_values_lab_test_id_idx" ON "lab_test_reference_values"("lab_test_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_values_param_id_idx" ON "lab_test_reference_values"("param_id");

-- CreateIndex
CREATE INDEX "lab_test_reference_values_deleted_at_idx" ON "lab_test_reference_values"("deleted_at");
