-- CreateEnum
CREATE TYPE "RegistrationIdSequenceType" AS ENUM ('ORDER', 'QUOTATION', 'APPOINTMENT', 'PATIENT');

-- CreateEnum
CREATE TYPE "RegistrationIdSeparator" AS ENUM ('NONE', 'HYPHEN', 'SLASH', 'UNDERSCORE');

-- CreateEnum
CREATE TYPE "RegistrationIdResetCycle" AS ENUM ('NEVER', 'DAILY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "AccessionBarcodeSeparator" AS ENUM ('NONE', 'HYPHEN', 'SLASH', 'UNDERSCORE');

-- CreateEnum
CREATE TYPE "AccessionBarcodeResetCycle" AS ENUM ('NEVER', 'DAILY', 'MONTHLY', 'YEARLY');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'TECHNICIAN_SETTINGS';

-- AlterTable
ALTER TABLE "accession_settings" ADD COLUMN     "accession_allow_mapping_after_accept_external_referral" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accession_allow_mapping_after_accept_inhouse" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accession_allow_mapping_after_accept_internal_referral" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accession_allow_mapping_before_accept_external_referral" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accession_allow_mapping_before_accept_inhouse" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accession_allow_mapping_before_accept_internal_referral" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accession_allow_mapping_for_outsource" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accession_critical_threshold_minutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "accession_external_referral_acceptance_threshold_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "accession_internal_referral_acceptance_threshold_minutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "accession_max_time_to_accept_sample_minutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "accession_min_time_to_accept_sample_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "accession_warning_threshold_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "sample_barcode_settings_current_number" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sample_barcode_settings_last_reset_at" TIMESTAMP(3),
ADD COLUMN     "sample_barcode_settings_number_length" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "sample_barcode_settings_prefix" VARCHAR(24) NOT NULL DEFAULT '',
ADD COLUMN     "sample_barcode_settings_reset_interval" "AccessionBarcodeResetCycle" NOT NULL DEFAULT 'NEVER',
ADD COLUMN     "sample_barcode_settings_separator" "AccessionBarcodeSeparator" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "sample_barcode_settings_suffix" VARCHAR(24) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "patient_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patient_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_category_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "patient_category_id" TEXT NOT NULL,
    "branch_lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_category_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_category_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "patient_category_id" TEXT NOT NULL,
    "branch_lab_panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_category_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "general_allow_add_patient_photo" BOOLEAN NOT NULL DEFAULT true,
    "general_view_medical_history" BOOLEAN NOT NULL DEFAULT true,
    "general_view_past_orders" BOOLEAN NOT NULL DEFAULT true,
    "general_allow_editing_order_date" BOOLEAN NOT NULL DEFAULT false,
    "general_allow_editing_payment_date" BOOLEAN NOT NULL DEFAULT false,
    "general_default_payment_mode" "PaymentMode" NOT NULL DEFAULT 'CASH',
    "quotation_quotation_validity_value" INTEGER NOT NULL DEFAULT 7,
    "quotation_quotation_validity_unit" "RepeatIntervalUnit" NOT NULL DEFAULT 'DAYS',
    "quotation_allow_duplication_of_expired_quotation" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_visit_charges_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "charges_and_deductions_visit_charges_editable" BOOLEAN NOT NULL DEFAULT true,
    "charges_and_deductions_sample_collection_charges_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "charges_and_deductions_sample_collection_charges_editable" BOOLEAN NOT NULL DEFAULT true,
    "charges_and_deductions_allow_wallet_deduction" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_maximum_wallet_deduction_percent" INTEGER NOT NULL DEFAULT 100,
    "charges_and_deductions_allow_loyalty_deduction" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_maximum_loyalty_points_equivalent_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "charges_and_deductions_allow_clear_previous_dues" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_allow_order_without_clearing_previous_dues" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_minimum_previous_dues_to_clear" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "charges_and_deductions_allow_partial_billing" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_minimum_percent_of_net_amount_to_proceed" INTEGER NOT NULL DEFAULT 0,
    "charges_and_deductions_tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_minimum_tds_percent" INTEGER NOT NULL DEFAULT 0,
    "charges_and_deductions_maximum_tds_percent" INTEGER NOT NULL DEFAULT 0,
    "charges_and_deductions_allow_discounts" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_minimum_discount_percent" INTEGER NOT NULL DEFAULT 0,
    "charges_and_deductions_maximum_discount_percent" INTEGER NOT NULL DEFAULT 0,
    "charges_and_deductions_allow_line_item_discount" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_minimum_line_item_discount_percent" INTEGER NOT NULL DEFAULT 0,
    "charges_and_deductions_maximum_line_item_discount_percent" INTEGER NOT NULL DEFAULT 0,
    "charges_and_deductions_allow_partial_billing_of_discounted_order" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_allow_order_discount_only" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_allow_line_discount_only" BOOLEAN NOT NULL DEFAULT false,
    "charges_and_deductions_allow_both_order_and_line_discount" BOOLEAN NOT NULL DEFAULT false,
    "cancellation_and_refund_allow_order_cancellation" BOOLEAN NOT NULL DEFAULT true,
    "cancellation_and_refund_allow_partial_cancellation" BOOLEAN NOT NULL DEFAULT false,
    "cancellation_and_refund_allow_refund" BOOLEAN NOT NULL DEFAULT true,
    "cancellation_and_refund_allow_partial_refund" BOOLEAN NOT NULL DEFAULT false,
    "cancellation_and_refund_cancellation_charges_applicable" BOOLEAN NOT NULL DEFAULT false,
    "cancellation_and_refund_cancellation_charges_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cancellation_and_refund_refund_charges_applicable" BOOLEAN NOT NULL DEFAULT false,
    "cancellation_and_refund_refund_charges_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "referral_and_staff_permissions_allow_add_referral" BOOLEAN NOT NULL DEFAULT true,
    "referral_and_staff_permissions_allow_add_referral_panel" BOOLEAN NOT NULL DEFAULT true,
    "referral_and_staff_permissions_allow_add_internal_referral_user" BOOLEAN NOT NULL DEFAULT true,
    "referral_and_staff_permissions_allow_add_external_referral_user" BOOLEAN NOT NULL DEFAULT true,
    "referral_and_staff_permissions_allow_add_doctor_name" BOOLEAN NOT NULL DEFAULT true,
    "referral_and_staff_permissions_allow_add_radiologist_name" BOOLEAN NOT NULL DEFAULT true,
    "referral_and_staff_permissions_allow_add_radiology_technician_name" BOOLEAN NOT NULL DEFAULT true,
    "referral_and_staff_permissions_allow_add_phlebotomist_name" BOOLEAN NOT NULL DEFAULT true,
    "billing_menu_allow_collection_of_amount_by_other_user" BOOLEAN NOT NULL DEFAULT false,
    "billing_menu_allow_cancellation_by_other_user" BOOLEAN NOT NULL DEFAULT false,
    "billing_menu_allow_bill_copy_print_for_paid_billings_only" BOOLEAN NOT NULL DEFAULT true,
    "billing_menu_allow_other_user_to_edit_quotation" BOOLEAN NOT NULL DEFAULT false,
    "appointment_allow_check_in_for_paid_appointments_only" BOOLEAN NOT NULL DEFAULT false,
    "appointment_allow_progress_of_unpaid_and_partial_paid_appointments" BOOLEAN NOT NULL DEFAULT false,
    "patients_allow_merging_two_patients" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "registration_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_id_sequences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "sequence_type" "RegistrationIdSequenceType" NOT NULL,
    "prefix" VARCHAR(24) NOT NULL DEFAULT '',
    "suffix" VARCHAR(24) NOT NULL DEFAULT '',
    "separator" "RegistrationIdSeparator" NOT NULL DEFAULT 'NONE',
    "number_length" INTEGER NOT NULL DEFAULT 6,
    "reset_cycle" "RegistrationIdResetCycle" NOT NULL DEFAULT 'NEVER',
    "current_number" INTEGER NOT NULL DEFAULT 0,
    "last_reset_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "registration_id_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_categories_tenant_id_idx" ON "patient_categories"("tenant_id");

-- CreateIndex
CREATE INDEX "patient_categories_deleted_at_idx" ON "patient_categories"("deleted_at");

-- CreateIndex
CREATE INDEX "patient_category_lab_tests_tenant_id_idx" ON "patient_category_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "patient_category_lab_tests_branch_id_idx" ON "patient_category_lab_tests"("branch_id");

-- CreateIndex
CREATE INDEX "patient_category_lab_tests_patient_category_id_idx" ON "patient_category_lab_tests"("patient_category_id");

-- CreateIndex
CREATE INDEX "patient_category_lab_tests_branch_lab_test_id_idx" ON "patient_category_lab_tests"("branch_lab_test_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_category_lab_tests_patient_category_id_branch_lab_t_key" ON "patient_category_lab_tests"("patient_category_id", "branch_lab_test_id");

-- CreateIndex
CREATE INDEX "patient_category_lab_panels_tenant_id_idx" ON "patient_category_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "patient_category_lab_panels_branch_id_idx" ON "patient_category_lab_panels"("branch_id");

-- CreateIndex
CREATE INDEX "patient_category_lab_panels_patient_category_id_idx" ON "patient_category_lab_panels"("patient_category_id");

-- CreateIndex
CREATE INDEX "patient_category_lab_panels_branch_lab_panel_id_idx" ON "patient_category_lab_panels"("branch_lab_panel_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_category_lab_panels_patient_category_id_branch_lab__key" ON "patient_category_lab_panels"("patient_category_id", "branch_lab_panel_id");

-- CreateIndex
CREATE INDEX "registration_settings_tenant_id_idx" ON "registration_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "registration_settings_branch_id_idx" ON "registration_settings"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_settings_tenant_id_branch_id_key" ON "registration_settings"("tenant_id", "branch_id");

-- CreateIndex
CREATE INDEX "registration_id_sequences_tenant_id_idx" ON "registration_id_sequences"("tenant_id");

-- CreateIndex
CREATE INDEX "registration_id_sequences_branch_id_idx" ON "registration_id_sequences"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_id_sequences_tenant_id_branch_id_sequence_type_key" ON "registration_id_sequences"("tenant_id", "branch_id", "sequence_type");

-- AddForeignKey
ALTER TABLE "patient_category_lab_tests" ADD CONSTRAINT "patient_category_lab_tests_patient_category_id_fkey" FOREIGN KEY ("patient_category_id") REFERENCES "patient_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_category_lab_tests" ADD CONSTRAINT "patient_category_lab_tests_branch_lab_test_id_fkey" FOREIGN KEY ("branch_lab_test_id") REFERENCES "branch_lab_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_category_lab_panels" ADD CONSTRAINT "patient_category_lab_panels_patient_category_id_fkey" FOREIGN KEY ("patient_category_id") REFERENCES "patient_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_category_lab_panels" ADD CONSTRAINT "patient_category_lab_panels_branch_lab_panel_id_fkey" FOREIGN KEY ("branch_lab_panel_id") REFERENCES "branch_lab_panels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
