-- CreateTable
CREATE TABLE "branch_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "source_lab_test_id" TEXT,
    "source_master_data_id" TEXT,
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
    "commission_price" INTEGER NOT NULL DEFAULT 0,
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
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "is_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "useful_for" TEXT,
    "interpretation_of_results" TEXT,
    "limitations" TEXT,
    "remarks" TEXT,
    "references" TEXT,
    "config_snapshot" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "source_lab_panel_id" TEXT,
    "source_master_data_id" TEXT,
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
    "commission_price" INTEGER NOT NULL DEFAULT 0,
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
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_lab_panel_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "branch_lab_panel_id" TEXT NOT NULL,
    "branch_lab_test_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_removable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_lab_panel_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_lab_tests_tenant_id_idx" ON "branch_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_lab_tests_branch_id_idx" ON "branch_lab_tests"("branch_id");

-- CreateIndex
CREATE INDEX "branch_lab_tests_source_lab_test_id_idx" ON "branch_lab_tests"("source_lab_test_id");

-- CreateIndex
CREATE INDEX "branch_lab_tests_is_active_idx" ON "branch_lab_tests"("is_active");

-- CreateIndex
CREATE INDEX "branch_lab_tests_is_default_idx" ON "branch_lab_tests"("is_default");

-- CreateIndex
CREATE INDEX "branch_lab_tests_deleted_at_idx" ON "branch_lab_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_lab_panels_tenant_id_idx" ON "branch_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_lab_panels_branch_id_idx" ON "branch_lab_panels"("branch_id");

-- CreateIndex
CREATE INDEX "branch_lab_panels_source_lab_panel_id_idx" ON "branch_lab_panels"("source_lab_panel_id");

-- CreateIndex
CREATE INDEX "branch_lab_panels_is_active_idx" ON "branch_lab_panels"("is_active");

-- CreateIndex
CREATE INDEX "branch_lab_panels_is_default_idx" ON "branch_lab_panels"("is_default");

-- CreateIndex
CREATE INDEX "branch_lab_panels_deleted_at_idx" ON "branch_lab_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_tenant_id_idx" ON "branch_lab_panel_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_branch_id_idx" ON "branch_lab_panel_tests"("branch_id");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_branch_lab_panel_id_idx" ON "branch_lab_panel_tests"("branch_lab_panel_id");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_branch_lab_panel_id_sort_order_idx" ON "branch_lab_panel_tests"("branch_lab_panel_id", "sort_order");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_branch_lab_test_id_idx" ON "branch_lab_panel_tests"("branch_lab_test_id");

-- CreateIndex
CREATE INDEX "branch_lab_panel_tests_deleted_at_idx" ON "branch_lab_panel_tests"("deleted_at");
