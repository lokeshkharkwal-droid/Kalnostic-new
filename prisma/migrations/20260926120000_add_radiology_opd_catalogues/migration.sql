-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "branch_opd_panel_id" TEXT,
ADD COLUMN     "branch_opd_test_id" TEXT,
ADD COLUMN     "branch_radiology_panel_id" TEXT,
ADD COLUMN     "branch_radiology_test_id" TEXT;

-- CreateTable
CREATE TABLE "radiology_master_data" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_master_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "master_data_id" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "cloned_from_id" TEXT,
    "template_synced_at" TIMESTAMP(3),
    "source_master_test_id" TEXT,
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
    "processing_time_from" TEXT,
    "processing_time_to" TEXT,
    "proc_time_min_value" INTEGER,
    "proc_time_min_unit" "TatUnit",
    "proc_time_max_value" INTEGER,
    "proc_time_max_unit" "TatUnit",
    "approval_time_from" TEXT,
    "approval_time_to" TEXT,
    "reporting_time_from" TEXT,
    "reporting_time_to" TEXT,
    "approval_duration_min_value" INTEGER,
    "approval_duration_min_unit" "TatUnit",
    "approval_duration_max_value" INTEGER,
    "approval_duration_max_unit" "TatUnit",
    "is_hide_in_order_screen" BOOLEAN NOT NULL DEFAULT false,
    "is_preference_test" BOOLEAN NOT NULL DEFAULT false,
    "is_outsource" BOOLEAN NOT NULL DEFAULT false,
    "is_bill_only_test" BOOLEAN NOT NULL DEFAULT false,
    "is_sample_flow" BOOLEAN NOT NULL DEFAULT false,
    "is_mandatory_test" BOOLEAN NOT NULL DEFAULT false,
    "mandatory_dept_id" TEXT,
    "mandatory_cat_id" TEXT,
    "mandatory_subcat_id" TEXT,
    "is_repeat_interval_restriction" BOOLEAN NOT NULL DEFAULT false,
    "repeat_interval_value" INTEGER,
    "repeat_interval_unit" "RepeatIntervalUnit",
    "is_override_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "useful_for" TEXT,
    "interpretation_of_results" TEXT,
    "limitations" TEXT,
    "remarks" TEXT,
    "references" TEXT,
    "version_history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_test_samples" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "test_id" TEXT NOT NULL,
    "sample_name_id" TEXT,
    "sample_name" TEXT,
    "sample_type" TEXT,
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

    CONSTRAINT "radiology_test_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_test_result_params" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "test_id" TEXT NOT NULL,
    "group_name" TEXT,
    "group_layout" "ResultGroupLayout",
    "group_layout_id" TEXT,
    "group_settings_id" TEXT,
    "parameter_name" TEXT NOT NULL,
    "parameter_code" TEXT NOT NULL,
    "method" TEXT,
    "attach_file_url" TEXT,
    "icon_settings_id" TEXT,
    "image_settings_id" TEXT,
    "reporting_unit" TEXT,
    "result_type" "ResultType" NOT NULL,
    "parameter_type" "ParameterType" NOT NULL DEFAULT 'MEASURED',
    "result_entry_mode" "ResultEntryMode" NOT NULL DEFAULT 'MANUAL',
    "calculation_formula" TEXT,
    "result_rounding_type" "ResultRounding" NOT NULL DEFAULT 'TWO_DECIMAL',
    "allowable_units" TEXT,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "result_suggestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_value" TEXT,
    "critical_min" DECIMAL(10,4),
    "critical_max" DECIMAL(10,4),
    "reflex_tests" JSONB NOT NULL DEFAULT '[]',
    "overall_result_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "is_nabl" BOOLEAN NOT NULL DEFAULT false,
    "is_cap" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiology_test_result_params_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_test_reference_ranges" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "test_id" TEXT NOT NULL,
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

    CONSTRAINT "radiology_test_reference_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_test_reference_values" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "test_id" TEXT NOT NULL,
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

    CONSTRAINT "radiology_test_reference_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "master_data_id" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "source_master_panel_id" TEXT,
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
    "is_fasting_required" BOOLEAN NOT NULL DEFAULT false,
    "is_show_online_booking" BOOLEAN NOT NULL DEFAULT true,
    "is_home_collection" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_partial_billing" BOOLEAN NOT NULL DEFAULT false,
    "max_tests_removable" INTEGER NOT NULL DEFAULT 0,
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
    "panel_id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
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
    "source_test_id" TEXT,
    "source_master_data_id" TEXT,
    "list_id" TEXT NOT NULL,
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
    "processing_time_from" TEXT,
    "processing_time_to" TEXT,
    "proc_time_min_value" INTEGER,
    "proc_time_min_unit" "TatUnit",
    "proc_time_max_value" INTEGER,
    "proc_time_max_unit" "TatUnit",
    "approval_time_from" TEXT,
    "approval_time_to" TEXT,
    "reporting_time_from" TEXT,
    "reporting_time_to" TEXT,
    "approval_duration_min_value" INTEGER,
    "approval_duration_min_unit" "TatUnit",
    "approval_duration_max_value" INTEGER,
    "approval_duration_max_unit" "TatUnit",
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

    CONSTRAINT "branch_radiology_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_radiology_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "source_panel_id" TEXT,
    "source_master_data_id" TEXT,
    "list_id" TEXT NOT NULL,
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

    CONSTRAINT "branch_radiology_panels_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "branch_radiology_panel_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "branch_panel_id" TEXT NOT NULL,
    "branch_test_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_removable" BOOLEAN NOT NULL DEFAULT true,
    "discount_percent" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_radiology_panel_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opd_master_data" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "opd_master_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opd_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "master_data_id" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "cloned_from_id" TEXT,
    "template_synced_at" TIMESTAMP(3),
    "source_master_test_id" TEXT,
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
    "processing_time_from" TEXT,
    "processing_time_to" TEXT,
    "proc_time_min_value" INTEGER,
    "proc_time_min_unit" "TatUnit",
    "proc_time_max_value" INTEGER,
    "proc_time_max_unit" "TatUnit",
    "approval_time_from" TEXT,
    "approval_time_to" TEXT,
    "reporting_time_from" TEXT,
    "reporting_time_to" TEXT,
    "approval_duration_min_value" INTEGER,
    "approval_duration_min_unit" "TatUnit",
    "approval_duration_max_value" INTEGER,
    "approval_duration_max_unit" "TatUnit",
    "is_hide_in_order_screen" BOOLEAN NOT NULL DEFAULT false,
    "is_preference_test" BOOLEAN NOT NULL DEFAULT false,
    "is_outsource" BOOLEAN NOT NULL DEFAULT false,
    "is_bill_only_test" BOOLEAN NOT NULL DEFAULT false,
    "is_sample_flow" BOOLEAN NOT NULL DEFAULT false,
    "is_mandatory_test" BOOLEAN NOT NULL DEFAULT false,
    "mandatory_dept_id" TEXT,
    "mandatory_cat_id" TEXT,
    "mandatory_subcat_id" TEXT,
    "is_repeat_interval_restriction" BOOLEAN NOT NULL DEFAULT false,
    "repeat_interval_value" INTEGER,
    "repeat_interval_unit" "RepeatIntervalUnit",
    "is_override_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "useful_for" TEXT,
    "interpretation_of_results" TEXT,
    "limitations" TEXT,
    "remarks" TEXT,
    "references" TEXT,
    "version_history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "opd_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opd_test_samples" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "test_id" TEXT NOT NULL,
    "sample_name_id" TEXT,
    "sample_name" TEXT,
    "sample_type" TEXT,
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

    CONSTRAINT "opd_test_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opd_test_result_params" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "test_id" TEXT NOT NULL,
    "group_name" TEXT,
    "group_layout" "ResultGroupLayout",
    "group_layout_id" TEXT,
    "group_settings_id" TEXT,
    "parameter_name" TEXT NOT NULL,
    "parameter_code" TEXT NOT NULL,
    "method" TEXT,
    "attach_file_url" TEXT,
    "icon_settings_id" TEXT,
    "image_settings_id" TEXT,
    "reporting_unit" TEXT,
    "result_type" "ResultType" NOT NULL,
    "parameter_type" "ParameterType" NOT NULL DEFAULT 'MEASURED',
    "result_entry_mode" "ResultEntryMode" NOT NULL DEFAULT 'MANUAL',
    "calculation_formula" TEXT,
    "result_rounding_type" "ResultRounding" NOT NULL DEFAULT 'TWO_DECIMAL',
    "allowable_units" TEXT,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "result_suggestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_value" TEXT,
    "critical_min" DECIMAL(10,4),
    "critical_max" DECIMAL(10,4),
    "reflex_tests" JSONB NOT NULL DEFAULT '[]',
    "overall_result_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "is_nabl" BOOLEAN NOT NULL DEFAULT false,
    "is_cap" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "opd_test_result_params_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opd_test_reference_ranges" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "test_id" TEXT NOT NULL,
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

    CONSTRAINT "opd_test_reference_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opd_test_reference_values" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "test_id" TEXT NOT NULL,
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

    CONSTRAINT "opd_test_reference_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opd_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "master_data_id" TEXT,
    "source" "DataSource" NOT NULL DEFAULT 'TENANT',
    "source_master_panel_id" TEXT,
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
    "is_fasting_required" BOOLEAN NOT NULL DEFAULT false,
    "is_show_online_booking" BOOLEAN NOT NULL DEFAULT true,
    "is_home_collection" BOOLEAN NOT NULL DEFAULT false,
    "is_allow_partial_billing" BOOLEAN NOT NULL DEFAULT false,
    "max_tests_removable" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "opd_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opd_panel_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "panel_id" TEXT NOT NULL,
    "test_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_removable" BOOLEAN NOT NULL DEFAULT true,
    "discount_percent" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "opd_panel_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_opd_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "source_test_id" TEXT,
    "source_master_data_id" TEXT,
    "list_id" TEXT NOT NULL,
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
    "processing_time_from" TEXT,
    "processing_time_to" TEXT,
    "proc_time_min_value" INTEGER,
    "proc_time_min_unit" "TatUnit",
    "proc_time_max_value" INTEGER,
    "proc_time_max_unit" "TatUnit",
    "approval_time_from" TEXT,
    "approval_time_to" TEXT,
    "reporting_time_from" TEXT,
    "reporting_time_to" TEXT,
    "approval_duration_min_value" INTEGER,
    "approval_duration_min_unit" "TatUnit",
    "approval_duration_max_value" INTEGER,
    "approval_duration_max_unit" "TatUnit",
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

    CONSTRAINT "branch_opd_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_opd_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "source_panel_id" TEXT,
    "source_master_data_id" TEXT,
    "list_id" TEXT NOT NULL,
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

    CONSTRAINT "branch_opd_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_opd_test_lists" (
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

    CONSTRAINT "branch_opd_test_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_opd_panel_lists" (
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

    CONSTRAINT "branch_opd_panel_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_opd_panel_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "branch_panel_id" TEXT NOT NULL,
    "branch_test_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_removable" BOOLEAN NOT NULL DEFAULT true,
    "discount_percent" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_opd_panel_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "radiology_master_data_tenant_id_idx" ON "radiology_master_data"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_master_data_branch_id_idx" ON "radiology_master_data"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_master_data_deleted_at_idx" ON "radiology_master_data"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_tests_tenant_id_idx" ON "radiology_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_tests_branch_id_idx" ON "radiology_tests"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_tests_master_data_id_idx" ON "radiology_tests"("master_data_id");

-- CreateIndex
CREATE INDEX "radiology_tests_is_active_idx" ON "radiology_tests"("is_active");

-- CreateIndex
CREATE INDEX "radiology_tests_source_idx" ON "radiology_tests"("source");

-- CreateIndex
CREATE INDEX "radiology_tests_cloned_from_id_idx" ON "radiology_tests"("cloned_from_id");

-- CreateIndex
CREATE INDEX "radiology_tests_source_master_test_id_idx" ON "radiology_tests"("source_master_test_id");

-- CreateIndex
CREATE INDEX "radiology_tests_deleted_at_idx" ON "radiology_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_test_samples_tenant_id_idx" ON "radiology_test_samples"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_test_samples_branch_id_idx" ON "radiology_test_samples"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_test_samples_test_id_idx" ON "radiology_test_samples"("test_id");

-- CreateIndex
CREATE INDEX "radiology_test_samples_deleted_at_idx" ON "radiology_test_samples"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_test_result_params_tenant_id_idx" ON "radiology_test_result_params"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_test_result_params_branch_id_idx" ON "radiology_test_result_params"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_test_result_params_test_id_idx" ON "radiology_test_result_params"("test_id");

-- CreateIndex
CREATE INDEX "radiology_test_result_params_test_id_sort_order_idx" ON "radiology_test_result_params"("test_id", "sort_order");

-- CreateIndex
CREATE INDEX "radiology_test_result_params_deleted_at_idx" ON "radiology_test_result_params"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_test_reference_ranges_tenant_id_idx" ON "radiology_test_reference_ranges"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_test_reference_ranges_branch_id_idx" ON "radiology_test_reference_ranges"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_test_reference_ranges_test_id_idx" ON "radiology_test_reference_ranges"("test_id");

-- CreateIndex
CREATE INDEX "radiology_test_reference_ranges_param_id_idx" ON "radiology_test_reference_ranges"("param_id");

-- CreateIndex
CREATE INDEX "radiology_test_reference_ranges_deleted_at_idx" ON "radiology_test_reference_ranges"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_test_reference_values_tenant_id_idx" ON "radiology_test_reference_values"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_test_reference_values_branch_id_idx" ON "radiology_test_reference_values"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_test_reference_values_test_id_idx" ON "radiology_test_reference_values"("test_id");

-- CreateIndex
CREATE INDEX "radiology_test_reference_values_param_id_idx" ON "radiology_test_reference_values"("param_id");

-- CreateIndex
CREATE INDEX "radiology_test_reference_values_deleted_at_idx" ON "radiology_test_reference_values"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_panels_tenant_id_idx" ON "radiology_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_panels_branch_id_idx" ON "radiology_panels"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_panels_master_data_id_idx" ON "radiology_panels"("master_data_id");

-- CreateIndex
CREATE INDEX "radiology_panels_is_active_idx" ON "radiology_panels"("is_active");

-- CreateIndex
CREATE INDEX "radiology_panels_source_idx" ON "radiology_panels"("source");

-- CreateIndex
CREATE INDEX "radiology_panels_source_master_panel_id_idx" ON "radiology_panels"("source_master_panel_id");

-- CreateIndex
CREATE INDEX "radiology_panels_deleted_at_idx" ON "radiology_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_tenant_id_idx" ON "radiology_panel_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_branch_id_idx" ON "radiology_panel_tests"("branch_id");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_panel_id_idx" ON "radiology_panel_tests"("panel_id");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_panel_id_sort_order_idx" ON "radiology_panel_tests"("panel_id", "sort_order");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_test_id_idx" ON "radiology_panel_tests"("test_id");

-- CreateIndex
CREATE INDEX "radiology_panel_tests_deleted_at_idx" ON "radiology_panel_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_tenant_id_idx" ON "branch_radiology_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_branch_id_idx" ON "branch_radiology_tests"("branch_id");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_source_test_id_idx" ON "branch_radiology_tests"("source_test_id");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_list_id_idx" ON "branch_radiology_tests"("list_id");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_is_active_idx" ON "branch_radiology_tests"("is_active");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_is_default_idx" ON "branch_radiology_tests"("is_default");

-- CreateIndex
CREATE INDEX "branch_radiology_tests_deleted_at_idx" ON "branch_radiology_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_tenant_id_idx" ON "branch_radiology_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_branch_id_idx" ON "branch_radiology_panels"("branch_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_source_panel_id_idx" ON "branch_radiology_panels"("source_panel_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_list_id_idx" ON "branch_radiology_panels"("list_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_is_active_idx" ON "branch_radiology_panels"("is_active");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_is_default_idx" ON "branch_radiology_panels"("is_default");

-- CreateIndex
CREATE INDEX "branch_radiology_panels_deleted_at_idx" ON "branch_radiology_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_radiology_test_lists_tenant_id_idx" ON "branch_radiology_test_lists"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_radiology_test_lists_branch_id_idx" ON "branch_radiology_test_lists"("branch_id");

-- CreateIndex
CREATE INDEX "branch_radiology_test_lists_deleted_at_idx" ON "branch_radiology_test_lists"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_lists_tenant_id_idx" ON "branch_radiology_panel_lists"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_lists_branch_id_idx" ON "branch_radiology_panel_lists"("branch_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_lists_deleted_at_idx" ON "branch_radiology_panel_lists"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_tenant_id_idx" ON "branch_radiology_panel_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_branch_id_idx" ON "branch_radiology_panel_tests"("branch_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_branch_panel_id_idx" ON "branch_radiology_panel_tests"("branch_panel_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_branch_panel_id_sort_order_idx" ON "branch_radiology_panel_tests"("branch_panel_id", "sort_order");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_branch_test_id_idx" ON "branch_radiology_panel_tests"("branch_test_id");

-- CreateIndex
CREATE INDEX "branch_radiology_panel_tests_deleted_at_idx" ON "branch_radiology_panel_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "opd_master_data_tenant_id_idx" ON "opd_master_data"("tenant_id");

-- CreateIndex
CREATE INDEX "opd_master_data_branch_id_idx" ON "opd_master_data"("branch_id");

-- CreateIndex
CREATE INDEX "opd_master_data_deleted_at_idx" ON "opd_master_data"("deleted_at");

-- CreateIndex
CREATE INDEX "opd_tests_tenant_id_idx" ON "opd_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "opd_tests_branch_id_idx" ON "opd_tests"("branch_id");

-- CreateIndex
CREATE INDEX "opd_tests_master_data_id_idx" ON "opd_tests"("master_data_id");

-- CreateIndex
CREATE INDEX "opd_tests_is_active_idx" ON "opd_tests"("is_active");

-- CreateIndex
CREATE INDEX "opd_tests_source_idx" ON "opd_tests"("source");

-- CreateIndex
CREATE INDEX "opd_tests_cloned_from_id_idx" ON "opd_tests"("cloned_from_id");

-- CreateIndex
CREATE INDEX "opd_tests_source_master_test_id_idx" ON "opd_tests"("source_master_test_id");

-- CreateIndex
CREATE INDEX "opd_tests_deleted_at_idx" ON "opd_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "opd_test_samples_tenant_id_idx" ON "opd_test_samples"("tenant_id");

-- CreateIndex
CREATE INDEX "opd_test_samples_branch_id_idx" ON "opd_test_samples"("branch_id");

-- CreateIndex
CREATE INDEX "opd_test_samples_test_id_idx" ON "opd_test_samples"("test_id");

-- CreateIndex
CREATE INDEX "opd_test_samples_deleted_at_idx" ON "opd_test_samples"("deleted_at");

-- CreateIndex
CREATE INDEX "opd_test_result_params_tenant_id_idx" ON "opd_test_result_params"("tenant_id");

-- CreateIndex
CREATE INDEX "opd_test_result_params_branch_id_idx" ON "opd_test_result_params"("branch_id");

-- CreateIndex
CREATE INDEX "opd_test_result_params_test_id_idx" ON "opd_test_result_params"("test_id");

-- CreateIndex
CREATE INDEX "opd_test_result_params_test_id_sort_order_idx" ON "opd_test_result_params"("test_id", "sort_order");

-- CreateIndex
CREATE INDEX "opd_test_result_params_deleted_at_idx" ON "opd_test_result_params"("deleted_at");

-- CreateIndex
CREATE INDEX "opd_test_reference_ranges_tenant_id_idx" ON "opd_test_reference_ranges"("tenant_id");

-- CreateIndex
CREATE INDEX "opd_test_reference_ranges_branch_id_idx" ON "opd_test_reference_ranges"("branch_id");

-- CreateIndex
CREATE INDEX "opd_test_reference_ranges_test_id_idx" ON "opd_test_reference_ranges"("test_id");

-- CreateIndex
CREATE INDEX "opd_test_reference_ranges_param_id_idx" ON "opd_test_reference_ranges"("param_id");

-- CreateIndex
CREATE INDEX "opd_test_reference_ranges_deleted_at_idx" ON "opd_test_reference_ranges"("deleted_at");

-- CreateIndex
CREATE INDEX "opd_test_reference_values_tenant_id_idx" ON "opd_test_reference_values"("tenant_id");

-- CreateIndex
CREATE INDEX "opd_test_reference_values_branch_id_idx" ON "opd_test_reference_values"("branch_id");

-- CreateIndex
CREATE INDEX "opd_test_reference_values_test_id_idx" ON "opd_test_reference_values"("test_id");

-- CreateIndex
CREATE INDEX "opd_test_reference_values_param_id_idx" ON "opd_test_reference_values"("param_id");

-- CreateIndex
CREATE INDEX "opd_test_reference_values_deleted_at_idx" ON "opd_test_reference_values"("deleted_at");

-- CreateIndex
CREATE INDEX "opd_panels_tenant_id_idx" ON "opd_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "opd_panels_branch_id_idx" ON "opd_panels"("branch_id");

-- CreateIndex
CREATE INDEX "opd_panels_master_data_id_idx" ON "opd_panels"("master_data_id");

-- CreateIndex
CREATE INDEX "opd_panels_is_active_idx" ON "opd_panels"("is_active");

-- CreateIndex
CREATE INDEX "opd_panels_source_idx" ON "opd_panels"("source");

-- CreateIndex
CREATE INDEX "opd_panels_source_master_panel_id_idx" ON "opd_panels"("source_master_panel_id");

-- CreateIndex
CREATE INDEX "opd_panels_deleted_at_idx" ON "opd_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "opd_panel_tests_tenant_id_idx" ON "opd_panel_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "opd_panel_tests_branch_id_idx" ON "opd_panel_tests"("branch_id");

-- CreateIndex
CREATE INDEX "opd_panel_tests_panel_id_idx" ON "opd_panel_tests"("panel_id");

-- CreateIndex
CREATE INDEX "opd_panel_tests_panel_id_sort_order_idx" ON "opd_panel_tests"("panel_id", "sort_order");

-- CreateIndex
CREATE INDEX "opd_panel_tests_test_id_idx" ON "opd_panel_tests"("test_id");

-- CreateIndex
CREATE INDEX "opd_panel_tests_deleted_at_idx" ON "opd_panel_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_opd_tests_tenant_id_idx" ON "branch_opd_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_opd_tests_branch_id_idx" ON "branch_opd_tests"("branch_id");

-- CreateIndex
CREATE INDEX "branch_opd_tests_source_test_id_idx" ON "branch_opd_tests"("source_test_id");

-- CreateIndex
CREATE INDEX "branch_opd_tests_list_id_idx" ON "branch_opd_tests"("list_id");

-- CreateIndex
CREATE INDEX "branch_opd_tests_is_active_idx" ON "branch_opd_tests"("is_active");

-- CreateIndex
CREATE INDEX "branch_opd_tests_is_default_idx" ON "branch_opd_tests"("is_default");

-- CreateIndex
CREATE INDEX "branch_opd_tests_deleted_at_idx" ON "branch_opd_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_opd_panels_tenant_id_idx" ON "branch_opd_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_opd_panels_branch_id_idx" ON "branch_opd_panels"("branch_id");

-- CreateIndex
CREATE INDEX "branch_opd_panels_source_panel_id_idx" ON "branch_opd_panels"("source_panel_id");

-- CreateIndex
CREATE INDEX "branch_opd_panels_list_id_idx" ON "branch_opd_panels"("list_id");

-- CreateIndex
CREATE INDEX "branch_opd_panels_is_active_idx" ON "branch_opd_panels"("is_active");

-- CreateIndex
CREATE INDEX "branch_opd_panels_is_default_idx" ON "branch_opd_panels"("is_default");

-- CreateIndex
CREATE INDEX "branch_opd_panels_deleted_at_idx" ON "branch_opd_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_opd_test_lists_tenant_id_idx" ON "branch_opd_test_lists"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_opd_test_lists_branch_id_idx" ON "branch_opd_test_lists"("branch_id");

-- CreateIndex
CREATE INDEX "branch_opd_test_lists_deleted_at_idx" ON "branch_opd_test_lists"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_opd_panel_lists_tenant_id_idx" ON "branch_opd_panel_lists"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_opd_panel_lists_branch_id_idx" ON "branch_opd_panel_lists"("branch_id");

-- CreateIndex
CREATE INDEX "branch_opd_panel_lists_deleted_at_idx" ON "branch_opd_panel_lists"("deleted_at");

-- CreateIndex
CREATE INDEX "branch_opd_panel_tests_tenant_id_idx" ON "branch_opd_panel_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_opd_panel_tests_branch_id_idx" ON "branch_opd_panel_tests"("branch_id");

-- CreateIndex
CREATE INDEX "branch_opd_panel_tests_branch_panel_id_idx" ON "branch_opd_panel_tests"("branch_panel_id");

-- CreateIndex
CREATE INDEX "branch_opd_panel_tests_branch_panel_id_sort_order_idx" ON "branch_opd_panel_tests"("branch_panel_id", "sort_order");

-- CreateIndex
CREATE INDEX "branch_opd_panel_tests_branch_test_id_idx" ON "branch_opd_panel_tests"("branch_test_id");

-- CreateIndex
CREATE INDEX "branch_opd_panel_tests_deleted_at_idx" ON "branch_opd_panel_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "order_items_branch_radiology_test_id_idx" ON "order_items"("branch_radiology_test_id");

-- CreateIndex
CREATE INDEX "order_items_branch_radiology_panel_id_idx" ON "order_items"("branch_radiology_panel_id");

-- CreateIndex
CREATE INDEX "order_items_branch_opd_test_id_idx" ON "order_items"("branch_opd_test_id");

-- CreateIndex
CREATE INDEX "order_items_branch_opd_panel_id_idx" ON "order_items"("branch_opd_panel_id");

-- AddForeignKey
ALTER TABLE "radiology_test_samples" ADD CONSTRAINT "radiology_test_samples_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "radiology_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_test_result_params" ADD CONSTRAINT "radiology_test_result_params_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "radiology_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_test_reference_ranges" ADD CONSTRAINT "radiology_test_reference_ranges_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "radiology_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_test_reference_values" ADD CONSTRAINT "radiology_test_reference_values_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "radiology_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_panel_tests" ADD CONSTRAINT "radiology_panel_tests_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "radiology_panels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_radiology_tests" ADD CONSTRAINT "branch_radiology_tests_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "branch_radiology_test_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_radiology_panels" ADD CONSTRAINT "branch_radiology_panels_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "branch_radiology_panel_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opd_test_samples" ADD CONSTRAINT "opd_test_samples_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "opd_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opd_test_result_params" ADD CONSTRAINT "opd_test_result_params_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "opd_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opd_test_reference_ranges" ADD CONSTRAINT "opd_test_reference_ranges_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "opd_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opd_test_reference_values" ADD CONSTRAINT "opd_test_reference_values_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "opd_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opd_panel_tests" ADD CONSTRAINT "opd_panel_tests_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "opd_panels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_opd_tests" ADD CONSTRAINT "branch_opd_tests_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "branch_opd_test_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_opd_panels" ADD CONSTRAINT "branch_opd_panels_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "branch_opd_panel_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_branch_radiology_test_id_fkey" FOREIGN KEY ("branch_radiology_test_id") REFERENCES "branch_radiology_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_branch_radiology_panel_id_fkey" FOREIGN KEY ("branch_radiology_panel_id") REFERENCES "branch_radiology_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_branch_opd_test_id_fkey" FOREIGN KEY ("branch_opd_test_id") REFERENCES "branch_opd_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_branch_opd_panel_id_fkey" FOREIGN KEY ("branch_opd_panel_id") REFERENCES "branch_opd_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterEnum: Combined Branch audit modules
ALTER TYPE "AuditModule" ADD VALUE IF NOT EXISTS 'RADIOLOGY';
ALTER TYPE "AuditModule" ADD VALUE IF NOT EXISTS 'OPD';
