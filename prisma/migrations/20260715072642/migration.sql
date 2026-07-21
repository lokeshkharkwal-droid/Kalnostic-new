/*
  Warnings:

  - You are about to drop the column `sub_category` on the `doctors` table. All the data in the column will be lost.
  - You are about to drop the column `raise_invoice_credit_limit` on the `referral_panel_settings` table. All the data in the column will be lost.
  - You are about to drop the column `profile_key` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `attachment` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `body` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `code` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `config` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `footer_block` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `header_block` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `trigger_event` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `templates` table. All the data in the column will be lost.
  - You are about to drop the column `role_key` on the `tenant_staff_memberships` table. All the data in the column will be lost.
  - You are about to drop the column `template_counter` on the `tenants` table. All the data in the column will be lost.
  - You are about to drop the column `profile_key` on the `user_branch_profiles` table. All the data in the column will be lost.
  - You are about to drop the column `profile_key` on the `user_profile_permission_overrides` table. All the data in the column will be lost.
  - You are about to drop the `doctor_branch_assignments` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `feature` to the `templates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `preference` to the `templates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `template` to the `templates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `auth_role_id` to the `user_branch_profiles` table without a default value. This is not possible if the table is not empty.
  - Added the required column `auth_role_id` to the `user_profile_permission_overrides` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SupportTenantType" AS ENUM ('BUSINESS', 'BRANCH');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MessagingChannel" AS ENUM ('EMAIL', 'SMS', 'IAM', 'IAA', 'PBN', 'WHATSAPP', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('OTP', 'TRANSACTIONAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "SmsType" AS ENUM ('TRANSACTIONAL', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "WhatsappMessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "ApplicableBranchType" AS ENUM ('LAB', 'CLINIC', 'HOSPITAL', 'BLOOD_BANK', 'RADIOLOGY');

-- CreateEnum
CREATE TYPE "MessagingLevel" AS ENUM ('ADMIN', 'BUSINESS');

-- CreateEnum
CREATE TYPE "ApplicationScope" AS ENUM ('KALNOSTIC');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('TENANT', 'SITE_ADMIN');

-- CreateEnum
CREATE TYPE "PatientCategory" AS ENUM ('GENERAL', 'VIP', 'SENIOR_CITIZEN', 'PEDIATRIC', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED', 'OTHER');

-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('DRAFT', 'CREATED');

-- CreateEnum
CREATE TYPE "AgeType" AS ENUM ('YEARS', 'MONTHS', 'DAYS');

-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('SELF', 'SPOUSE', 'SON', 'DAUGHTER', 'FATHER', 'MOTHER', 'BROTHER', 'SISTER', 'GUARDIAN', 'FRIEND', 'OTHER');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "PgCommissionType" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

-- CreateEnum
CREATE TYPE "PaymentRuleType" AS ENUM ('CITRUS_COMMISSION', 'PAYU_COMMISSION', 'PINELAB_COMMISSION', 'EZ_COMMISSION', 'PHARMACY_TAXES');

-- CreateEnum
CREATE TYPE "PaymentCalculationType" AS ENUM ('FIXED', 'PERCENT', 'RULE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'QUOTE', 'APPOINTMENT', 'ORDER');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('WALK_IN', 'APP', 'WEBSITE');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('CASH_CLIENT', 'INSURANCE', 'CORPORATE', 'GOVERNMENT_SCHEME', 'TPA');

-- CreateEnum
CREATE TYPE "SampleSource" AS ENUM ('IN_HOUSE', 'SUPPLIED');

-- CreateEnum
CREATE TYPE "ConsultantType" AS ENUM ('INITIAL', 'FIRST', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "OpdVisitType" AS ENUM ('WALK_IN', 'TELECONSULTATION', 'HOME_VISIT');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'CREDIT', 'UPI');

-- CreateEnum
CREATE TYPE "B2bClientType" AS ENUM ('CASH', 'CREDIT', 'WALLET');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditModule" ADD VALUE 'PDF_REPORT_TEMPLATE';
ALTER TYPE "AuditModule" ADD VALUE 'PATIENT';
ALTER TYPE "AuditModule" ADD VALUE 'MEDICAL_HISTORY';
ALTER TYPE "AuditModule" ADD VALUE 'ORDER';
ALTER TYPE "AuditModule" ADD VALUE 'RADIOLOGIST';
ALTER TYPE "AuditModule" ADD VALUE 'PHLEBOTOMIST';
ALTER TYPE "AuditModule" ADD VALUE 'RADIOLOGY_TECHNICIAN';
ALTER TYPE "AuditModule" ADD VALUE 'PAYMENT_DETAILS';

-- DropForeignKey
ALTER TABLE "doctor_branch_assignments" DROP CONSTRAINT "doctor_branch_assignments_branch_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_branch_assignments" DROP CONSTRAINT "doctor_branch_assignments_doctor_id_fkey";

-- DropIndex
DROP INDEX "templates_type_idx";

-- DropIndex
DROP INDEX "user_profile_permission_overrides_tenant_id_person_id_profi_idx";

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "cloned_from_id" TEXT,
ADD COLUMN     "source" "DataSource" NOT NULL DEFAULT 'TENANT',
ALTER COLUMN "tenant_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "cloned_from_id" TEXT,
ADD COLUMN     "source" "DataSource" NOT NULL DEFAULT 'TENANT',
ALTER COLUMN "tenant_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "doctors" DROP COLUMN "sub_category",
ADD COLUMN     "branch_id" TEXT,
ADD COLUMN     "consultation_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "emergency_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "follow_up_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "is_allow_discount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sub_category_id" TEXT;

-- AlterTable
ALTER TABLE "document_versions" ALTER COLUMN "branch_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "branch_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "internal_referrals" ADD COLUMN     "department" TEXT;

-- AlterTable
ALTER TABLE "lab_panel_tests" ALTER COLUMN "tenant_id" DROP NOT NULL,
ALTER COLUMN "branch_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "lab_panels" ADD COLUMN     "source" "DataSource" NOT NULL DEFAULT 'TENANT',
ALTER COLUMN "tenant_id" DROP NOT NULL,
ALTER COLUMN "branch_id" DROP NOT NULL,
ALTER COLUMN "master_data_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "lab_test" ADD COLUMN     "source" "DataSource" NOT NULL DEFAULT 'TENANT',
ALTER COLUMN "tenant_id" DROP NOT NULL,
ALTER COLUMN "branch_id" DROP NOT NULL,
ALTER COLUMN "master_data_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "lab_test_reference_ranges" ALTER COLUMN "tenant_id" DROP NOT NULL,
ALTER COLUMN "branch_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "lab_test_reference_values" ALTER COLUMN "tenant_id" DROP NOT NULL,
ALTER COLUMN "branch_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "lab_test_result_params" ALTER COLUMN "tenant_id" DROP NOT NULL,
ALTER COLUMN "branch_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "lab_test_samples" ALTER COLUMN "tenant_id" DROP NOT NULL,
ALTER COLUMN "branch_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "middle_name" TEXT,
ADD COLUMN     "qualification" TEXT;

-- AlterTable
ALTER TABLE "referral_panel_settings" DROP COLUMN "raise_invoice_credit_limit",
ADD COLUMN     "is_raise_invoice_on_credit_limit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "refresh_tokens" DROP COLUMN "profile_key",
ADD COLUMN     "auth_role_id" TEXT;

-- AlterTable
ALTER TABLE "sub_categories" ADD COLUMN     "cloned_from_id" TEXT,
ADD COLUMN     "source" "DataSource" NOT NULL DEFAULT 'TENANT',
ALTER COLUMN "tenant_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "templates" DROP COLUMN "attachment",
DROP COLUMN "body",
DROP COLUMN "code",
DROP COLUMN "config",
DROP COLUMN "footer_block",
DROP COLUMN "header_block",
DROP COLUMN "name",
DROP COLUMN "trigger_event",
DROP COLUMN "type",
DROP COLUMN "version",
ADD COLUMN     "applicable_branch_type" "ApplicableBranchType",
ADD COLUMN     "display_title" TEXT,
ADD COLUMN     "entity_id" TEXT,
ADD COLUMN     "entity_type" TEXT,
ADD COLUMN     "feature" TEXT NOT NULL,
ADD COLUMN     "file_name" TEXT,
ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "level" "MessagingLevel" NOT NULL DEFAULT 'BUSINESS',
ADD COLUMN     "message_type" "MessageType",
ADD COLUMN     "preference" "MessagingChannel" NOT NULL,
ADD COLUMN     "sms_sender_id" TEXT,
ADD COLUMN     "sms_template_id" TEXT,
ADD COLUMN     "sms_type" "SmsType",
ADD COLUMN     "specific_application" "ApplicationScope",
ADD COLUMN     "template" TEXT NOT NULL,
ADD COLUMN     "template_category" "WhatsappTemplateCategory",
ADD COLUMN     "template_type" "WhatsappMessageType",
ALTER COLUMN "tenant_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tenant_staff_memberships" DROP COLUMN "role_key",
ADD COLUMN     "auth_role_id" TEXT;

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "template_counter",
ADD COLUMN     "address_line" TEXT,
ADD COLUMN     "area_id" TEXT,
ADD COLUMN     "city_id" TEXT,
ADD COLUMN     "country_id" TEXT,
ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "order_counter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "photo_url" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "short_name" TEXT,
ADD COLUMN     "state_id" TEXT,
ADD COLUMN     "updated_by" TEXT;

-- AlterTable
ALTER TABLE "user_branch_profiles" DROP COLUMN "profile_key",
ADD COLUMN     "auth_role_id" TEXT NOT NULL,
ADD COLUMN     "enabled_modules" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "user_profile_permission_overrides" DROP COLUMN "profile_key",
ADD COLUMN     "auth_role_id" TEXT NOT NULL;

-- DropTable
DROP TABLE "doctor_branch_assignments";

-- DropEnum
DROP TYPE "DoctorAvailability";

-- DropEnum
DROP TYPE "DoctorBranchRole";

-- DropEnum
DROP TYPE "TemplateType";

-- DropEnum
DROP TYPE "TriggerEvent";

-- CreateTable
CREATE TABLE "tenant_configurations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_admin_url" TEXT,
    "site_title" TEXT,
    "logo_path" TEXT,
    "logo_link" TEXT,
    "template" TEXT,
    "theme" "Theme" NOT NULL DEFAULT 'LIGHT',
    "patient_order_url" TEXT,
    "max_orders_per_day_per_branch" INTEGER,
    "max_users_allowed" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "is_external_doctor_out_referral_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_external_doctor_in_referral_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_external_hospital_out_referral_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_external_hospital_in_referral_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_patient_order_payment_allowed" BOOLEAN NOT NULL DEFAULT false,
    "is_cms_order_bill_generation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "referral_pg_commission_type" "PgCommissionType" NOT NULL DEFAULT 'EXCLUSIVE',
    "patient_pg_commission_type" "PgCommissionType" NOT NULL DEFAULT 'EXCLUSIVE',
    "franchise_branch_pg_commission_type" "PgCommissionType" NOT NULL DEFAULT 'EXCLUSIVE',
    "can_patient_wallet_go_negative" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siteadmin_counters" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "department_counter" INTEGER NOT NULL DEFAULT 0,
    "category_counter" INTEGER NOT NULL DEFAULT 0,
    "sub_category_counter" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "siteadmin_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "states" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pin_code" TEXT NOT NULL,
    "state_id" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "state_id" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_roles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowed_branch_types" "BranchType"[],
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "auth_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_report_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "branch_id" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "doc" JSONB,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pdf_report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_groups" (
    "id" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "test_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_group_mappings" (
    "id" TEXT NOT NULL,
    "test_group_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "test_group_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_rules" (
    "id" TEXT NOT NULL,
    "rule_type" "PaymentRuleType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "tenant_id" INTEGER,
    "branch_id" INTEGER,
    "rank" INTEGER NOT NULL,
    "context_type" INTEGER,
    "context_id" INTEGER,
    "class_1" TEXT,
    "class_2" TEXT,
    "calculation_type" "PaymentCalculationType" NOT NULL,
    "calculation_value" TEXT NOT NULL,
    "tax_type" TEXT,
    "tax_percentage" INTEGER,
    "effective_period_start_date" TIMESTAMP(3),
    "effective_period_end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_infos" (
    "id" TEXT NOT NULL,
    "meta_type" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "tenant_type" "SupportTenantType" NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'ACTIVE',
    "request_url" TEXT,
    "help_content" TEXT NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "support_infos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_submissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "salutation" "Salutation",
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT,
    "gender" "Gender",
    "relationship" "Relationship",
    "date_of_birth" DATE,
    "age" INTEGER,
    "age_type" "AgeType",
    "mobile" TEXT NOT NULL,
    "whatsapp_number" TEXT,
    "email" TEXT,
    "alternate_email" TEXT,
    "alternate_mobile_number" TEXT,
    "country" TEXT,
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "area" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "has_privilege_card" BOOLEAN NOT NULL DEFAULT false,
    "privilege_number" TEXT,
    "patient_category" "PatientCategory",
    "marital_status" "MaritalStatus",
    "um_id" TEXT,
    "aadhaar_number" TEXT,
    "pan_number" TEXT,
    "passport_number" TEXT,
    "guardian_name" TEXT,
    "guardian_relationship" "Relationship",
    "guardian_email" TEXT,
    "guardian_mobile_number" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_mobile_number" TEXT,
    "status" "PatientStatus" NOT NULL DEFAULT 'CREATED',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_histories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "is_current_smoker" BOOLEAN NOT NULL DEFAULT false,
    "is_former_smoker" BOOLEAN NOT NULL DEFAULT false,
    "is_current_alcoholic" BOOLEAN NOT NULL DEFAULT false,
    "is_former_alcoholic" BOOLEAN NOT NULL DEFAULT false,
    "has_cough" BOOLEAN NOT NULL DEFAULT false,
    "has_fever" BOOLEAN NOT NULL DEFAULT false,
    "has_shortness_of_breath" BOOLEAN NOT NULL DEFAULT false,
    "has_chest_pain" BOOLEAN NOT NULL DEFAULT false,
    "has_abdominal_pain" BOOLEAN NOT NULL DEFAULT false,
    "has_headache" BOOLEAN NOT NULL DEFAULT false,
    "has_vomiting" BOOLEAN NOT NULL DEFAULT false,
    "has_diarrhea" BOOLEAN NOT NULL DEFAULT false,
    "has_fatigue" BOOLEAN NOT NULL DEFAULT false,
    "has_weight_loss" BOOLEAN NOT NULL DEFAULT false,
    "has_body_pains" BOOLEAN NOT NULL DEFAULT false,
    "has_dizziness" BOOLEAN NOT NULL DEFAULT false,
    "has_diabetes" BOOLEAN NOT NULL DEFAULT false,
    "has_hypertension" BOOLEAN NOT NULL DEFAULT false,
    "has_cardiac_disease" BOOLEAN NOT NULL DEFAULT false,
    "has_thyroid_disease" BOOLEAN NOT NULL DEFAULT false,
    "has_kidney_disease" BOOLEAN NOT NULL DEFAULT false,
    "has_anti_diabetic_drugs" BOOLEAN NOT NULL DEFAULT false,
    "has_anti_hypertension_drugs" BOOLEAN NOT NULL DEFAULT false,
    "has_blood_thinners" BOOLEAN NOT NULL DEFAULT false,
    "has_vitamin_supplements" BOOLEAN NOT NULL DEFAULT false,
    "other_medications" TEXT,
    "has_latex_allergy" BOOLEAN NOT NULL DEFAULT false,
    "has_food_allergy" BOOLEAN NOT NULL DEFAULT false,
    "has_drug_allergy" BOOLEAN NOT NULL DEFAULT false,
    "surgical_history" TEXT,
    "remarks" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "medical_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_code" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE NOT NULL,
    "order_type" "OrderType" NOT NULL,
    "billing_type" "BillingType" NOT NULL,
    "is_urgent_bill" BOOLEAN NOT NULL DEFAULT false,
    "is_bill_generated" BOOLEAN NOT NULL DEFAULT false,
    "order_notes" TEXT,
    "patient_id" TEXT NOT NULL,
    "appointment_at" TIMESTAMP(3),
    "referred_by_doctor_id" TEXT,
    "referral_panel_id" TEXT,
    "b2b_client" "B2bClientType",
    "internal_referral_id" TEXT,
    "external_referral_id" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "branch_lab_test_id" TEXT,
    "branch_lab_panel_id" TEXT,
    "direct" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_diagnostics" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "prescription_url" TEXT,
    "diagnostic_panel_id" TEXT,
    "sample_source" "SampleSource" NOT NULL DEFAULT 'IN_HOUSE',
    "sample_collection_charges" INTEGER NOT NULL DEFAULT 0,
    "logistics_supplied_by" TEXT,
    "is_fasting" BOOLEAN NOT NULL DEFAULT false,
    "is_home_visit" BOOLEAN NOT NULL DEFAULT false,
    "collection_address" TEXT,
    "phlebotomist_id" TEXT,
    "visit_charges" INTEGER NOT NULL DEFAULT 0,
    "collection_at" TIMESTAMP(3),
    "geo_location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "order_diagnostics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_opd" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "department_id" TEXT,
    "category_id" TEXT,
    "doctor_id" TEXT NOT NULL,
    "consultant_type" "ConsultantType",
    "visit_type" "OpdVisitType",
    "consultation_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "order_opd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_radiology" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "radiologist_id" TEXT NOT NULL,
    "radiologist_department_id" TEXT,
    "radiologist_category_id" TEXT,
    "radiology_technician_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "order_radiology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiologists" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "department_id" TEXT,
    "speciality" TEXT,
    "qualification" TEXT,
    "license_number" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "radiologists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phlebotomists" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "phlebotomists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_details" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "order_id" TEXT NOT NULL,
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "order_discount" INTEGER NOT NULL DEFAULT 0,
    "visiting_charges" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "deduct_from_wallet" INTEGER NOT NULL DEFAULT 0,
    "deduct_from_points" INTEGER NOT NULL DEFAULT 0,
    "has_cleared_previous_dues" BOOLEAN NOT NULL DEFAULT false,
    "tds_deduction" INTEGER NOT NULL DEFAULT 0,
    "payable_amount" INTEGER NOT NULL DEFAULT 0,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "remaining_balance" INTEGER NOT NULL DEFAULT 0,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'CASH',
    "payment_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_configurations_tenant_id_key" ON "tenant_configurations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "countries_deleted_at_idx" ON "countries"("deleted_at");

-- CreateIndex
CREATE INDEX "states_country_id_idx" ON "states"("country_id");

-- CreateIndex
CREATE INDEX "states_deleted_at_idx" ON "states"("deleted_at");

-- CreateIndex
CREATE INDEX "cities_state_id_idx" ON "cities"("state_id");

-- CreateIndex
CREATE INDEX "cities_country_id_idx" ON "cities"("country_id");

-- CreateIndex
CREATE INDEX "cities_deleted_at_idx" ON "cities"("deleted_at");

-- CreateIndex
CREATE INDEX "areas_city_id_idx" ON "areas"("city_id");

-- CreateIndex
CREATE INDEX "areas_state_id_idx" ON "areas"("state_id");

-- CreateIndex
CREATE INDEX "areas_country_id_idx" ON "areas"("country_id");

-- CreateIndex
CREATE INDEX "areas_deleted_at_idx" ON "areas"("deleted_at");

-- CreateIndex
CREATE INDEX "auth_roles_tenant_id_idx" ON "auth_roles"("tenant_id");

-- CreateIndex
CREATE INDEX "auth_roles_deleted_at_idx" ON "auth_roles"("deleted_at");

-- CreateIndex
CREATE INDEX "pdf_report_templates_tenant_id_idx" ON "pdf_report_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "pdf_report_templates_branch_id_idx" ON "pdf_report_templates"("branch_id");

-- CreateIndex
CREATE INDEX "pdf_report_templates_type_idx" ON "pdf_report_templates"("type");

-- CreateIndex
CREATE INDEX "pdf_report_templates_deleted_at_idx" ON "pdf_report_templates"("deleted_at");

-- CreateIndex
CREATE INDEX "test_groups_deleted_at_idx" ON "test_groups"("deleted_at");

-- CreateIndex
CREATE INDEX "test_group_mappings_test_group_id_idx" ON "test_group_mappings"("test_group_id");

-- CreateIndex
CREATE INDEX "test_group_mappings_lab_test_id_idx" ON "test_group_mappings"("lab_test_id");

-- CreateIndex
CREATE INDEX "test_group_mappings_deleted_at_idx" ON "test_group_mappings"("deleted_at");

-- CreateIndex
CREATE INDEX "payment_rules_rule_type_idx" ON "payment_rules"("rule_type");

-- CreateIndex
CREATE INDEX "payment_rules_tenant_id_idx" ON "payment_rules"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_rules_code_idx" ON "payment_rules"("code");

-- CreateIndex
CREATE INDEX "payment_rules_deleted_at_idx" ON "payment_rules"("deleted_at");

-- CreateIndex
CREATE INDEX "support_infos_meta_type_idx" ON "support_infos"("meta_type");

-- CreateIndex
CREATE INDEX "support_infos_code_idx" ON "support_infos"("code");

-- CreateIndex
CREATE INDEX "support_infos_status_idx" ON "support_infos"("status");

-- CreateIndex
CREATE INDEX "support_infos_deleted_at_idx" ON "support_infos"("deleted_at");

-- CreateIndex
CREATE INDEX "contact_submissions_created_at_idx" ON "contact_submissions"("created_at");

-- CreateIndex
CREATE INDEX "contact_submissions_deleted_at_idx" ON "contact_submissions"("deleted_at");

-- CreateIndex
CREATE INDEX "patients_tenant_id_idx" ON "patients"("tenant_id");

-- CreateIndex
CREATE INDEX "patients_branch_id_idx" ON "patients"("branch_id");

-- CreateIndex
CREATE INDEX "patients_deleted_at_idx" ON "patients"("deleted_at");

-- CreateIndex
CREATE INDEX "medical_histories_tenant_id_idx" ON "medical_histories"("tenant_id");

-- CreateIndex
CREATE INDEX "medical_histories_patient_id_idx" ON "medical_histories"("patient_id");

-- CreateIndex
CREATE INDEX "medical_histories_branch_id_idx" ON "medical_histories"("branch_id");

-- CreateIndex
CREATE INDEX "medical_histories_deleted_at_idx" ON "medical_histories"("deleted_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");

-- CreateIndex
CREATE INDEX "orders_branch_id_idx" ON "orders"("branch_id");

-- CreateIndex
CREATE INDEX "orders_patient_id_idx" ON "orders"("patient_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_referred_by_doctor_id_idx" ON "orders"("referred_by_doctor_id");

-- CreateIndex
CREATE INDEX "orders_referral_panel_id_idx" ON "orders"("referral_panel_id");

-- CreateIndex
CREATE INDEX "orders_internal_referral_id_idx" ON "orders"("internal_referral_id");

-- CreateIndex
CREATE INDEX "orders_external_referral_id_idx" ON "orders"("external_referral_id");

-- CreateIndex
CREATE INDEX "orders_deleted_at_idx" ON "orders"("deleted_at");

-- CreateIndex
CREATE INDEX "order_items_tenant_id_idx" ON "order_items"("tenant_id");

-- CreateIndex
CREATE INDEX "order_items_branch_id_idx" ON "order_items"("branch_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_branch_lab_test_id_idx" ON "order_items"("branch_lab_test_id");

-- CreateIndex
CREATE INDEX "order_items_branch_lab_panel_id_idx" ON "order_items"("branch_lab_panel_id");

-- CreateIndex
CREATE INDEX "order_items_deleted_at_idx" ON "order_items"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_diagnostics_order_id_key" ON "order_diagnostics"("order_id");

-- CreateIndex
CREATE INDEX "order_diagnostics_tenant_id_idx" ON "order_diagnostics"("tenant_id");

-- CreateIndex
CREATE INDEX "order_diagnostics_branch_id_idx" ON "order_diagnostics"("branch_id");

-- CreateIndex
CREATE INDEX "order_diagnostics_diagnostic_panel_id_idx" ON "order_diagnostics"("diagnostic_panel_id");

-- CreateIndex
CREATE INDEX "order_diagnostics_phlebotomist_id_idx" ON "order_diagnostics"("phlebotomist_id");

-- CreateIndex
CREATE INDEX "order_diagnostics_deleted_at_idx" ON "order_diagnostics"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_opd_order_id_key" ON "order_opd"("order_id");

-- CreateIndex
CREATE INDEX "order_opd_tenant_id_idx" ON "order_opd"("tenant_id");

-- CreateIndex
CREATE INDEX "order_opd_branch_id_idx" ON "order_opd"("branch_id");

-- CreateIndex
CREATE INDEX "order_opd_department_id_idx" ON "order_opd"("department_id");

-- CreateIndex
CREATE INDEX "order_opd_category_id_idx" ON "order_opd"("category_id");

-- CreateIndex
CREATE INDEX "order_opd_doctor_id_idx" ON "order_opd"("doctor_id");

-- CreateIndex
CREATE INDEX "order_opd_deleted_at_idx" ON "order_opd"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_radiology_order_id_key" ON "order_radiology"("order_id");

-- CreateIndex
CREATE INDEX "order_radiology_tenant_id_idx" ON "order_radiology"("tenant_id");

-- CreateIndex
CREATE INDEX "order_radiology_branch_id_idx" ON "order_radiology"("branch_id");

-- CreateIndex
CREATE INDEX "order_radiology_radiologist_id_idx" ON "order_radiology"("radiologist_id");

-- CreateIndex
CREATE INDEX "order_radiology_radiologist_department_id_idx" ON "order_radiology"("radiologist_department_id");

-- CreateIndex
CREATE INDEX "order_radiology_radiologist_category_id_idx" ON "order_radiology"("radiologist_category_id");

-- CreateIndex
CREATE INDEX "order_radiology_radiology_technician_id_idx" ON "order_radiology"("radiology_technician_id");

-- CreateIndex
CREATE INDEX "order_radiology_deleted_at_idx" ON "order_radiology"("deleted_at");

-- CreateIndex
CREATE INDEX "radiologists_tenant_id_idx" ON "radiologists"("tenant_id");

-- CreateIndex
CREATE INDEX "radiologists_branch_id_idx" ON "radiologists"("branch_id");

-- CreateIndex
CREATE INDEX "radiologists_department_id_idx" ON "radiologists"("department_id");

-- CreateIndex
CREATE INDEX "radiologists_deleted_at_idx" ON "radiologists"("deleted_at");

-- CreateIndex
CREATE INDEX "phlebotomists_tenant_id_idx" ON "phlebotomists"("tenant_id");

-- CreateIndex
CREATE INDEX "phlebotomists_branch_id_idx" ON "phlebotomists"("branch_id");

-- CreateIndex
CREATE INDEX "phlebotomists_deleted_at_idx" ON "phlebotomists"("deleted_at");

-- CreateIndex
CREATE INDEX "payment_details_tenant_id_idx" ON "payment_details"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_details_branch_id_idx" ON "payment_details"("branch_id");

-- CreateIndex
CREATE INDEX "payment_details_order_id_idx" ON "payment_details"("order_id");

-- CreateIndex
CREATE INDEX "payment_details_deleted_at_idx" ON "payment_details"("deleted_at");

-- CreateIndex
CREATE INDEX "categories_source_idx" ON "categories"("source");

-- CreateIndex
CREATE INDEX "categories_cloned_from_id_idx" ON "categories"("cloned_from_id");

-- CreateIndex
CREATE INDEX "departments_source_idx" ON "departments"("source");

-- CreateIndex
CREATE INDEX "departments_cloned_from_id_idx" ON "departments"("cloned_from_id");

-- CreateIndex
CREATE INDEX "doctors_branch_id_idx" ON "doctors"("branch_id");

-- CreateIndex
CREATE INDEX "doctors_sub_category_id_idx" ON "doctors"("sub_category_id");

-- CreateIndex
CREATE INDEX "lab_panels_source_idx" ON "lab_panels"("source");

-- CreateIndex
CREATE INDEX "lab_test_source_idx" ON "lab_test"("source");

-- CreateIndex
CREATE INDEX "refresh_tokens_auth_role_id_idx" ON "refresh_tokens"("auth_role_id");

-- CreateIndex
CREATE INDEX "sub_categories_source_idx" ON "sub_categories"("source");

-- CreateIndex
CREATE INDEX "sub_categories_cloned_from_id_idx" ON "sub_categories"("cloned_from_id");

-- CreateIndex
CREATE INDEX "templates_preference_idx" ON "templates"("preference");

-- CreateIndex
CREATE INDEX "templates_feature_idx" ON "templates"("feature");

-- CreateIndex
CREATE INDEX "tenant_staff_memberships_auth_role_id_idx" ON "tenant_staff_memberships"("auth_role_id");

-- CreateIndex
CREATE INDEX "tenants_country_id_idx" ON "tenants"("country_id");

-- CreateIndex
CREATE INDEX "tenants_state_id_idx" ON "tenants"("state_id");

-- CreateIndex
CREATE INDEX "tenants_city_id_idx" ON "tenants"("city_id");

-- CreateIndex
CREATE INDEX "tenants_area_id_idx" ON "tenants"("area_id");

-- CreateIndex
CREATE INDEX "user_branch_profiles_auth_role_id_idx" ON "user_branch_profiles"("auth_role_id");

-- CreateIndex
CREATE INDEX "user_profile_permission_overrides_tenant_id_person_id_auth__idx" ON "user_profile_permission_overrides"("tenant_id", "person_id", "auth_role_id");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_configurations" ADD CONSTRAINT "tenant_configurations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_auth_role_id_fkey" FOREIGN KEY ("auth_role_id") REFERENCES "auth_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "states" ADD CONSTRAINT "states_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_profiles" ADD CONSTRAINT "user_branch_profiles_auth_role_id_fkey" FOREIGN KEY ("auth_role_id") REFERENCES "auth_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profile_permission_overrides" ADD CONSTRAINT "user_profile_permission_overrides_auth_role_id_fkey" FOREIGN KEY ("auth_role_id") REFERENCES "auth_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_staff_memberships" ADD CONSTRAINT "tenant_staff_memberships_auth_role_id_fkey" FOREIGN KEY ("auth_role_id") REFERENCES "auth_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_group_mappings" ADD CONSTRAINT "test_group_mappings_test_group_id_fkey" FOREIGN KEY ("test_group_id") REFERENCES "test_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_histories" ADD CONSTRAINT "medical_histories_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_referred_by_doctor_id_fkey" FOREIGN KEY ("referred_by_doctor_id") REFERENCES "referral_doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_referral_panel_id_fkey" FOREIGN KEY ("referral_panel_id") REFERENCES "referral_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_internal_referral_id_fkey" FOREIGN KEY ("internal_referral_id") REFERENCES "internal_referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_external_referral_id_fkey" FOREIGN KEY ("external_referral_id") REFERENCES "external_referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_branch_lab_test_id_fkey" FOREIGN KEY ("branch_lab_test_id") REFERENCES "branch_lab_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_branch_lab_panel_id_fkey" FOREIGN KEY ("branch_lab_panel_id") REFERENCES "branch_lab_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_diagnostics" ADD CONSTRAINT "order_diagnostics_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_diagnostics" ADD CONSTRAINT "order_diagnostics_diagnostic_panel_id_fkey" FOREIGN KEY ("diagnostic_panel_id") REFERENCES "lab_panels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_diagnostics" ADD CONSTRAINT "order_diagnostics_phlebotomist_id_fkey" FOREIGN KEY ("phlebotomist_id") REFERENCES "phlebotomists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_opd" ADD CONSTRAINT "order_opd_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_opd" ADD CONSTRAINT "order_opd_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_opd" ADD CONSTRAINT "order_opd_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_opd" ADD CONSTRAINT "order_opd_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_radiology" ADD CONSTRAINT "order_radiology_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_radiology" ADD CONSTRAINT "order_radiology_radiologist_id_fkey" FOREIGN KEY ("radiologist_id") REFERENCES "radiologists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_radiology" ADD CONSTRAINT "order_radiology_radiologist_department_id_fkey" FOREIGN KEY ("radiologist_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_radiology" ADD CONSTRAINT "order_radiology_radiologist_category_id_fkey" FOREIGN KEY ("radiologist_category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_radiology" ADD CONSTRAINT "order_radiology_radiology_technician_id_fkey" FOREIGN KEY ("radiology_technician_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiologists" ADD CONSTRAINT "radiologists_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_details" ADD CONSTRAINT "payment_details_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
