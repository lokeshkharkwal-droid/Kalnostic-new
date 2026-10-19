-- CreateEnum
CREATE TYPE "RadiologyModality" AS ENUM ('XRAY', 'CT', 'MRI', 'ULTRASOUND', 'MAMMOGRAPHY', 'PET', 'FLUOROSCOPY', 'DEXA', 'OTHER');

-- CreateEnum
CREATE TYPE "RadiologyStudyStatus" AS ENUM ('NEW', 'SCHEDULED', 'ACQUIRED', 'REPORTED', 'VALIDATED', 'APPROVED', 'PUBLISHED', 'HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RadiologyReportingDoctorType" AS ENUM ('REPORTING', 'CONSULTANT');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "branch_radiology_panel_id" TEXT,
ADD COLUMN     "branch_radiology_test_id" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "radiology_outsource_center_counter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "radiology_study_counter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "radiology_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "master_data_id" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "cloned_from_id" TEXT,
    "template_synced_at" TIMESTAMP(3),
    "source_master_radiology_test_id" TEXT,
    "test_name" TEXT NOT NULL,
    "test_display_name" TEXT,
    "test_code" TEXT NOT NULL,
    "aka" TEXT,
    "modality" "RadiologyModality" NOT NULL DEFAULT 'OTHER',
    "body_part" TEXT,
    "view" TEXT,
    "is_contrast" BOOLEAN NOT NULL DEFAULT false,
    "department_id" TEXT,
    "category_id" TEXT,
    "sub_category_id" TEXT,
    "icd_code" TEXT,
    "loinc_code" TEXT,
    "clinical_tags" TEXT[],
    "report_template_id" TEXT,
    "sample_priority_type" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "is_enable_cms" BOOLEAN NOT NULL DEFAULT true,
    "approval_workflow" "ApprovalWorkflow",
    "price_msrp" INTEGER NOT NULL DEFAULT 0,
    "price_maximum" INTEGER NOT NULL DEFAULT 0,
    "price_minimum" INTEGER NOT NULL DEFAULT 0,
    "price_original" INTEGER NOT NULL DEFAULT 0,
    "franchise_price" INTEGER NOT NULL DEFAULT 0,
    "emergency_price" INTEGER NOT NULL DEFAULT 0,
    "commission_price" INTEGER,
    "discount_cap_pct" INTEGER NOT NULL DEFAULT 0,
    "is_allow_price_override" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_discounts" BOOLEAN NOT NULL DEFAULT true,
    "tat_min_value" INTEGER,
    "tat_min_unit" "TatUnit",
    "tat_max_value" INTEGER,
    "tat_max_unit" "TatUnit",
    "schedule_days" "DayOfWeek"[],
    "schedule_from" TEXT,
    "schedule_to" TEXT,
    "is_hide_in_order_screen" BOOLEAN NOT NULL DEFAULT false,
    "is_preference_test" BOOLEAN NOT NULL DEFAULT false,
    "is_outsource" BOOLEAN NOT NULL DEFAULT false,
    "is_bill_only_test" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "useful_for" TEXT,
    "interpretation_of_results" TEXT,
    "limitations" TEXT,
    "remarks" TEXT,
    "references" TEXT,
    "preparation_instructions" TEXT,
    "version_history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "master_data_id" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "cloned_from_id" TEXT,
    "template_synced_at" TIMESTAMP(3),
    "source_master_radiology_panel_id" TEXT,
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
    "commission_price" INTEGER,
    "tat_min_value" INTEGER,
    "tat_min_unit" "TatUnit" DEFAULT 'HOURS',
    "tat_max_value" INTEGER,
    "tat_max_unit" "TatUnit" DEFAULT 'HOURS',
    "panel_instructions" TEXT,
    "is_disable_discount" BOOLEAN NOT NULL DEFAULT false,
    "is_enable_cms" BOOLEAN NOT NULL DEFAULT true,
    "is_preference" BOOLEAN NOT NULL DEFAULT false,
    "is_show_online_booking" BOOLEAN NOT NULL DEFAULT true,
    "is_bill_only_test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_panel_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "radiology_panel_id" TEXT NOT NULL,
    "radiology_test_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_removable" BOOLEAN NOT NULL DEFAULT true,
    "discount_percent" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_panel_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_radiology_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "source_radiology_test_id" TEXT,
    "source_master_data_id" TEXT,
    "list_id" TEXT,
    "test_name" TEXT NOT NULL,
    "test_display_name" TEXT,
    "test_code" TEXT NOT NULL,
    "aka" TEXT,
    "modality" "RadiologyModality" NOT NULL DEFAULT 'OTHER',
    "body_part" TEXT,
    "view" TEXT,
    "is_contrast" BOOLEAN NOT NULL DEFAULT false,
    "department_id" TEXT,
    "category_id" TEXT,
    "sub_category_id" TEXT,
    "icd_code" TEXT,
    "loinc_code" TEXT,
    "clinical_tags" TEXT[],
    "report_template_id" TEXT,
    "sample_priority_type" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "is_enable_cms" BOOLEAN NOT NULL DEFAULT true,
    "price_msrp" INTEGER NOT NULL DEFAULT 0,
    "price_maximum" INTEGER NOT NULL DEFAULT 0,
    "price_minimum" INTEGER NOT NULL DEFAULT 0,
    "price_original" INTEGER NOT NULL DEFAULT 0,
    "franchise_price" INTEGER NOT NULL DEFAULT 0,
    "emergency_price" INTEGER NOT NULL DEFAULT 0,
    "commission_price" INTEGER,
    "discount_cap_pct" INTEGER NOT NULL DEFAULT 0,
    "is_allow_price_override" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_discounts" BOOLEAN NOT NULL DEFAULT true,
    "list_price" INTEGER NOT NULL DEFAULT 0,
    "tat_min_value" INTEGER,
    "tat_min_unit" "TatUnit",
    "tat_max_value" INTEGER,
    "tat_max_unit" "TatUnit",
    "schedule_days" "DayOfWeek"[],
    "schedule_from" TEXT,
    "schedule_to" TEXT,
    "is_hide_in_order_screen" BOOLEAN NOT NULL DEFAULT false,
    "is_preference_test" BOOLEAN NOT NULL DEFAULT false,
    "is_bill_only_test" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "is_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "useful_for" TEXT,
    "interpretation_of_results" TEXT,
    "limitations" TEXT,
    "remarks" TEXT,
    "references" TEXT,
    "preparation_instructions" TEXT,
    "config_snapshot" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_radiology_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_radiology_test_lists" (
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

    CONSTRAINT "branch_radiology_test_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_radiology_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "source_radiology_panel_id" TEXT,
    "source_master_data_id" TEXT,
    "list_id" TEXT,
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
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "is_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "price_msrp" INTEGER NOT NULL DEFAULT 0,
    "price_minimum" INTEGER NOT NULL DEFAULT 0,
    "price_maximum" INTEGER NOT NULL DEFAULT 0,
    "price_original" INTEGER NOT NULL DEFAULT 0,
    "franchise_price" INTEGER NOT NULL DEFAULT 0,
    "commission_price" INTEGER,
    "list_price" INTEGER NOT NULL DEFAULT 0,
    "tat_min_value" INTEGER,
    "tat_min_unit" "TatUnit" DEFAULT 'HOURS',
    "tat_max_value" INTEGER,
    "tat_max_unit" "TatUnit" DEFAULT 'HOURS',
    "panel_instructions" TEXT,
    "is_disable_discount" BOOLEAN NOT NULL DEFAULT false,
    "is_enable_cms" BOOLEAN NOT NULL DEFAULT true,
    "is_preference" BOOLEAN NOT NULL DEFAULT false,
    "is_show_online_booking" BOOLEAN NOT NULL DEFAULT true,
    "is_bill_only_test" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_radiology_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_radiology_panel_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "branch_radiology_panel_id" TEXT NOT NULL,
    "branch_radiology_test_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_removable" BOOLEAN NOT NULL DEFAULT true,
    "discount_percent" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_radiology_panel_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_radiology_panel_lists" (
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

    CONSTRAINT "branch_radiology_panel_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_reporting_doctors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "doctor_type" "RadiologyReportingDoctorType" NOT NULL DEFAULT 'REPORTING',
    "salutation" "Salutation",
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE,
    "gender" "Gender",
    "phone" TEXT NOT NULL,
    "alternate_phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "registration_no" TEXT NOT NULL,
    "registration_council" TEXT,
    "registration_expiry" DATE,
    "category_id" TEXT,
    "sub_category_id" TEXT,
    "department_id" TEXT,
    "is_nabl_authorized" BOOLEAN NOT NULL DEFAULT false,
    "is_cap_certified" BOOLEAN NOT NULL DEFAULT false,
    "is_iso_certified" BOOLEAN NOT NULL DEFAULT false,
    "is_report_signatory" BOOLEAN NOT NULL DEFAULT false,
    "signatory_name" TEXT,
    "signatory_designation" TEXT,
    "signature_image_path" TEXT,
    "signatory_department_ids" JSONB,
    "signatory_category_ids" JSONB,
    "signatory_sub_category_ids" JSONB,
    "account_holder_name" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "ifsc_code" TEXT,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "consultation_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "emergency_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "follow_up_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_allow_discount" BOOLEAN NOT NULL DEFAULT false,
    "status" "DoctorStatus" NOT NULL DEFAULT 'ACTIVE',
    "joining_date" DATE,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_reporting_doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_outsource_centers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "center_name" TEXT NOT NULL,
    "short_name" TEXT,
    "address" TEXT,
    "country" TEXT,
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
    "is_nabl_accredited" BOOLEAN NOT NULL DEFAULT false,
    "radiology_test_id" TEXT,
    "radiology_panel_id" TEXT,
    "branch_radiology_test_list_id" TEXT,
    "branch_radiology_panel_list_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_outsource_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_studies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "branch_radiology_test_id" TEXT,
    "branch_radiology_panel_id" TEXT,
    "radiology_test_id" TEXT,
    "department_id" TEXT,
    "radiology_test_name" TEXT,
    "modality" "RadiologyModality",
    "body_part" TEXT,
    "view" TEXT,
    "study_no" TEXT NOT NULL,
    "radiologist_id" TEXT,
    "technician_id" TEXT,
    "reporting_doctor_id" TEXT,
    "status" "RadiologyStudyStatus" NOT NULL DEFAULT 'NEW',
    "previous_status" "RadiologyStudyStatus",
    "priority" "SamplePriority" NOT NULL DEFAULT 'ROUTINE',
    "findings" TEXT,
    "impression" TEXT,
    "recommendation" TEXT,
    "report_template_id" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "acquired_at" TIMESTAMP(3),
    "reported_at" TIMESTAMP(3),
    "validated_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "notes" TEXT,
    "hold_reason" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_study_status_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "study_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "to_status" "RadiologyStudyStatus" NOT NULL,
    "from_status" "RadiologyStudyStatus",
    "reason" TEXT,
    "notes" TEXT,
    "attachment_url" TEXT,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_study_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "radiology_warning_threshold_minutes" INTEGER NOT NULL DEFAULT 60,
    "radiology_critical_threshold_minutes" INTEGER NOT NULL DEFAULT 30,
    "radiology_auto_publish_on_approve" BOOLEAN NOT NULL DEFAULT false,
    "radiology_require_validation" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "radiology_tests_tenant_id_idx" ON "radiology_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_tests_branch_id_idx" ON "radiology_tests"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_tests_master_data_id_idx" ON "radiology_tests"("master_data_id");

-- CreateIndex
CREATE INDEX "radiology_tests_department_id_idx" ON "radiology_tests"("department_id");

-- CreateIndex
CREATE INDEX "radiology_tests_category_id_idx" ON "radiology_tests"("category_id");

-- CreateIndex
CREATE INDEX "radiology_tests_sub_category_id_idx" ON "radiology_tests"("sub_category_id");

-- CreateIndex
CREATE INDEX "radiology_tests_modality_idx" ON "radiology_tests"("modality");

-- CreateIndex
CREATE INDEX "radiology_tests_is_active_idx" ON "radiology_tests"("is_active");

-- CreateIndex
CREATE INDEX "radiology_tests_source_idx" ON "radiology_tests"("source");

-- CreateIndex
CREATE INDEX "radiology_tests_cloned_from_id_idx" ON "radiology_tests"("cloned_from_id");

-- CreateIndex
CREATE INDEX "radiology_tests_source_master_radiology_test_id_idx" ON "radiology_tests"("source_master_radiology_test_id");

-- CreateIndex
CREATE INDEX "radiology_tests_deleted_at_idx" ON "radiology_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_panels_tenant_id_idx" ON "radiology_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_panels_branch_id_idx" ON "radiology_panels"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_panels_master_data_id_idx" ON "radiology_panels"("master_data_id");

-- CreateIndex
CREATE INDEX "radiology_panels_department_id_idx" ON "radiology_panels"("department_id");

-- CreateIndex
CREATE INDEX "radiology_panels_category_id_idx" ON "radiology_panels"("category_id");

-- CreateIndex
CREATE INDEX "radiology_panels_is_active_idx" ON "radiology_panels"("is_active");

-- CreateIndex
CREATE INDEX "radiology_panels_source_idx" ON "radiology_panels"("source");

-- CreateIndex
CREATE INDEX "radiology_panels_source_master_radiology_panel_id_idx" ON "radiology_panels"("source_master_radiology_panel_id");

-- CreateIndex
CREATE INDEX "radiology_panels_deleted_at_idx" ON "radiology_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_tenant_id_idx" ON "radiology_panel_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_branch_id_idx" ON "radiology_panel_tests"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_radiology_panel_id_idx" ON "radiology_panel_tests"("radiology_panel_id");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_radiology_panel_id_sort_order_idx" ON "radiology_panel_tests"("radiology_panel_id", "sort_order");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_radiology_test_id_idx" ON "radiology_panel_tests"("radiology_test_id");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_deleted_at_idx" ON "radiology_panel_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_tenant_id_idx" ON "branch_radiology_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_branch_id_idx" ON "branch_radiology_tests"("branch_id");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_source_radiology_test_id_idx" ON "branch_radiology_tests"("source_radiology_test_id");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_list_id_idx" ON "branch_radiology_tests"("list_id");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_modality_idx" ON "branch_radiology_tests"("modality");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_is_active_idx" ON "branch_radiology_tests"("is_active");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_is_default_idx" ON "branch_radiology_tests"("is_default");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_deleted_at_idx" ON "branch_radiology_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_radiology_test_lists_tenant_id_idx" ON "branch_radiology_test_lists"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_radiology_test_lists_branch_id_idx" ON "branch_radiology_test_lists"("branch_id");

-- CreateIndex
CREATE INDEX "branch_radiology_test_lists_deleted_at_idx" ON "branch_radiology_test_lists"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_tenant_id_idx" ON "branch_radiology_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_branch_id_idx" ON "branch_radiology_panels"("branch_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_source_radiology_panel_id_idx" ON "branch_radiology_panels"("source_radiology_panel_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_list_id_idx" ON "branch_radiology_panels"("list_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_is_active_idx" ON "branch_radiology_panels"("is_active");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_is_default_idx" ON "branch_radiology_panels"("is_default");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_deleted_at_idx" ON "branch_radiology_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_tenant_id_idx" ON "branch_radiology_panel_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_branch_id_idx" ON "branch_radiology_panel_tests"("branch_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_branch_radiology_panel_id_idx" ON "branch_radiology_panel_tests"("branch_radiology_panel_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_branch_radiology_panel_id_sort_idx" ON "branch_radiology_panel_tests"("branch_radiology_panel_id", "sort_order");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_branch_radiology_test_id_idx" ON "branch_radiology_panel_tests"("branch_radiology_test_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_deleted_at_idx" ON "branch_radiology_panel_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_lists_tenant_id_idx" ON "branch_radiology_panel_lists"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_lists_branch_id_idx" ON "branch_radiology_panel_lists"("branch_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_lists_deleted_at_idx" ON "branch_radiology_panel_lists"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_reporting_doctors_tenant_id_idx" ON "radiology_reporting_doctors"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_reporting_doctors_branch_id_idx" ON "radiology_reporting_doctors"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_reporting_doctors_category_id_idx" ON "radiology_reporting_doctors"("category_id");

-- CreateIndex
CREATE INDEX "radiology_reporting_doctors_sub_category_id_idx" ON "radiology_reporting_doctors"("sub_category_id");

-- CreateIndex
CREATE INDEX "radiology_reporting_doctors_department_id_idx" ON "radiology_reporting_doctors"("department_id");

-- CreateIndex
CREATE INDEX "radiology_reporting_doctors_status_idx" ON "radiology_reporting_doctors"("status");

-- CreateIndex
CREATE INDEX "radiology_reporting_doctors_deleted_at_idx" ON "radiology_reporting_doctors"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_outsource_centers_tenant_id_idx" ON "radiology_outsource_centers"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_outsource_centers_radiology_test_id_idx" ON "radiology_outsource_centers"("radiology_test_id");

-- CreateIndex
CREATE INDEX "radiology_outsource_centers_radiology_panel_id_idx" ON "radiology_outsource_centers"("radiology_panel_id");

-- CreateIndex
CREATE INDEX "radiology_outsource_centers_branch_radiology_test_list_id_idx" ON "radiology_outsource_centers"("branch_radiology_test_list_id");

-- CreateIndex
CREATE INDEX "radiology_outsource_centers_branch_radiology_panel_list_id_idx" ON "radiology_outsource_centers"("branch_radiology_panel_list_id");

-- CreateIndex
CREATE INDEX "radiology_outsource_centers_deleted_at_idx" ON "radiology_outsource_centers"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_studies_tenant_id_idx" ON "radiology_studies"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_studies_branch_id_idx" ON "radiology_studies"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_studies_order_id_idx" ON "radiology_studies"("order_id");

-- CreateIndex
CREATE INDEX "radiology_studies_order_item_id_idx" ON "radiology_studies"("order_item_id");

-- CreateIndex
CREATE INDEX "radiology_studies_radiologist_id_idx" ON "radiology_studies"("radiologist_id");

-- CreateIndex
CREATE INDEX "radiology_studies_status_idx" ON "radiology_studies"("status");

-- CreateIndex
CREATE INDEX "radiology_studies_deleted_at_idx" ON "radiology_studies"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_study_status_history_tenant_id_idx" ON "radiology_study_status_history"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_study_status_history_branch_id_idx" ON "radiology_study_status_history"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_study_status_history_study_id_idx" ON "radiology_study_status_history"("study_id");

-- CreateIndex
CREATE INDEX "radiology_study_status_history_created_at_idx" ON "radiology_study_status_history"("created_at");

-- CreateIndex
CREATE INDEX "radiology_study_status_history_deleted_at_idx" ON "radiology_study_status_history"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_settings_tenant_id_idx" ON "radiology_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_settings_branch_id_idx" ON "radiology_settings"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "radiology_settings_tenant_id_branch_id_key" ON "radiology_settings"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "order_items_branch_radiology_test_id_idx" ON "order_items"("branch_radiology_test_id");

-- CreateIndex
CREATE INDEX "order_items_branch_radiology_panel_id_idx" ON "order_items"("branch_radiology_panel_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_branch_radiology_test_id_fkey" FOREIGN KEY ("branch_radiology_test_id") REFERENCES "branch_radiology_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_branch_radiology_panel_id_fkey" FOREIGN KEY ("branch_radiology_panel_id") REFERENCES "branch_radiology_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_radiology_tests" ADD CONSTRAINT "branch_radiology_tests_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "branch_radiology_test_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_radiology_panels" ADD CONSTRAINT "branch_radiology_panels_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "branch_radiology_panel_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_studies" ADD CONSTRAINT "radiology_studies_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_study_status_history" ADD CONSTRAINT "radiology_study_status_history_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "radiology_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

