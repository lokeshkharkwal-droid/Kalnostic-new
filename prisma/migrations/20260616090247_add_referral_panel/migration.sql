-- CreateEnum
CREATE TYPE "ReferralDoctorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ReferralClientType" AS ENUM ('CASH', 'PREPAID', 'POSTPAID');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'SLAB_BASED', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "FixedCommissionCycle" AS ENUM ('ORDER_WISE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "PaymentCycle" AS ENUM ('NA', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUALLY');

-- CreateEnum
CREATE TYPE "ReferralPaymentMode" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditModule" ADD VALUE 'REFERRAL_PANEL';
ALTER TYPE "AuditModule" ADD VALUE 'REFERRAL_DOCTOR';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "referral_panel_counter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "referral_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referral_panel_name" TEXT NOT NULL,
    "short_name" TEXT,
    "panel_code" TEXT,
    "client_type" "ReferralClientType" NOT NULL,
    "referral_panel_settings_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "gst_number" TEXT,
    "pan_number" TEXT,
    "account_holder_name" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "ifsc_code" TEXT,
    "director_name" TEXT,
    "director_mobile" TEXT,
    "director_email" TEXT,
    "accession_person_name" TEXT,
    "accession_person_mobile" TEXT,
    "accession_person_email" TEXT,
    "registration_person_name" TEXT,
    "registration_person_mobile" TEXT,
    "registration_person_email" TEXT,
    "logistics_person_name" TEXT,
    "logistics_person_mobile" TEXT,
    "logistics_person_email" TEXT,
    "accounts_person_name" TEXT,
    "accounts_person_mobile" TEXT,
    "accounts_person_email" TEXT,
    "commission_applicable" BOOLEAN NOT NULL DEFAULT false,
    "commission_type" "CommissionType",
    "commission_pct_lab_test" DECIMAL(5,2),
    "commission_pct_lab_panel" DECIMAL(5,2),
    "commission_slabs" JSONB NOT NULL DEFAULT '[]',
    "fixed_commission_cycle" "FixedCommissionCycle",
    "fixed_amount" DECIMAL(10,2),
    "tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "payment_cycle" "PaymentCycle" NOT NULL DEFAULT 'NA',
    "payment_mode" "ReferralPaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "monthly_target_amount" INTEGER NOT NULL DEFAULT 0,
    "incentive_bonus_applicable" BOOLEAN NOT NULL DEFAULT false,
    "bonus_slabs" JSONB NOT NULL DEFAULT '[]',
    "file_name" TEXT,
    "file_url" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_panel_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_panel_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_panel_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_panel_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_panel_id" TEXT NOT NULL,
    "lab_panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_panel_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_doctors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT,
    "gender" "Gender" NOT NULL DEFAULT 'MALE',
    "date_of_birth" DATE,
    "mobile_number" TEXT NOT NULL,
    "email" TEXT,
    "aadhaar_number" TEXT,
    "pan_number" TEXT,
    "department_id" TEXT,
    "category_id" TEXT,
    "sub_category_id" TEXT,
    "medical_license_number" TEXT,
    "registration_council" TEXT,
    "registration_valid_till" DATE,
    "commission_applicable" BOOLEAN NOT NULL DEFAULT false,
    "commission_type" "CommissionType",
    "commission_pct_lab_test" DECIMAL(5,2),
    "commission_pct_lab_panel" DECIMAL(5,2),
    "commission_slabs" JSONB NOT NULL DEFAULT '[]',
    "fixed_commission_cycle" "FixedCommissionCycle",
    "fixed_amount" DECIMAL(10,2),
    "tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "payment_cycle" "PaymentCycle" NOT NULL DEFAULT 'NA',
    "payment_mode" "ReferralPaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "monthly_target_amount" INTEGER NOT NULL DEFAULT 0,
    "incentive_bonus_applicable" BOOLEAN NOT NULL DEFAULT false,
    "bonus_slabs" JSONB NOT NULL DEFAULT '[]',
    "file_name" TEXT,
    "file_url" TEXT,
    "remarks" TEXT,
    "status" "ReferralDoctorStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_doctor_qualifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_doctor_id" TEXT NOT NULL,
    "qualification_type" TEXT,
    "degree_name" TEXT,
    "institution_name" TEXT,
    "year_of_completion" INTEGER,
    "percentage_grade" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_doctor_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_doctor_experience" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_doctor_id" TEXT NOT NULL,
    "position" TEXT,
    "organisation" TEXT,
    "from_date" DATE,
    "to_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_doctor_experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_doctor_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_doctor_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_doctor_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_doctor_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "referral_doctor_id" TEXT NOT NULL,
    "lab_panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "referral_doctor_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referral_panels_tenant_id_idx" ON "referral_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_panels_deleted_at_idx" ON "referral_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_panel_lab_tests_tenant_id_idx" ON "referral_panel_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_tests_referral_panel_id_idx" ON "referral_panel_lab_tests"("referral_panel_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_tests_lab_test_id_idx" ON "referral_panel_lab_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_tests_deleted_at_idx" ON "referral_panel_lab_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_panel_lab_panels_tenant_id_idx" ON "referral_panel_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_panels_referral_panel_id_idx" ON "referral_panel_lab_panels"("referral_panel_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_panels_lab_panel_id_idx" ON "referral_panel_lab_panels"("lab_panel_id");

-- CreateIndex
CREATE INDEX "referral_panel_lab_panels_deleted_at_idx" ON "referral_panel_lab_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_doctors_tenant_id_idx" ON "referral_doctors"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_doctors_department_id_idx" ON "referral_doctors"("department_id");

-- CreateIndex
CREATE INDEX "referral_doctors_category_id_idx" ON "referral_doctors"("category_id");

-- CreateIndex
CREATE INDEX "referral_doctors_sub_category_id_idx" ON "referral_doctors"("sub_category_id");

-- CreateIndex
CREATE INDEX "referral_doctors_status_idx" ON "referral_doctors"("status");

-- CreateIndex
CREATE INDEX "referral_doctors_deleted_at_idx" ON "referral_doctors"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_doctor_qualifications_tenant_id_idx" ON "referral_doctor_qualifications"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_doctor_qualifications_referral_doctor_id_idx" ON "referral_doctor_qualifications"("referral_doctor_id");

-- CreateIndex
CREATE INDEX "referral_doctor_qualifications_deleted_at_idx" ON "referral_doctor_qualifications"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_doctor_experience_tenant_id_idx" ON "referral_doctor_experience"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_doctor_experience_referral_doctor_id_idx" ON "referral_doctor_experience"("referral_doctor_id");

-- CreateIndex
CREATE INDEX "referral_doctor_experience_deleted_at_idx" ON "referral_doctor_experience"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_tests_tenant_id_idx" ON "referral_doctor_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_tests_referral_doctor_id_idx" ON "referral_doctor_lab_tests"("referral_doctor_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_tests_lab_test_id_idx" ON "referral_doctor_lab_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_tests_deleted_at_idx" ON "referral_doctor_lab_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_panels_tenant_id_idx" ON "referral_doctor_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_panels_referral_doctor_id_idx" ON "referral_doctor_lab_panels"("referral_doctor_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_panels_lab_panel_id_idx" ON "referral_doctor_lab_panels"("lab_panel_id");

-- CreateIndex
CREATE INDEX "referral_doctor_lab_panels_deleted_at_idx" ON "referral_doctor_lab_panels"("deleted_at");

-- AddForeignKey
ALTER TABLE "referral_panel_lab_tests" ADD CONSTRAINT "referral_panel_lab_tests_referral_panel_id_fkey" FOREIGN KEY ("referral_panel_id") REFERENCES "referral_panels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_panel_lab_panels" ADD CONSTRAINT "referral_panel_lab_panels_referral_panel_id_fkey" FOREIGN KEY ("referral_panel_id") REFERENCES "referral_panels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctors" ADD CONSTRAINT "referral_doctors_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctors" ADD CONSTRAINT "referral_doctors_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctors" ADD CONSTRAINT "referral_doctors_sub_category_id_fkey" FOREIGN KEY ("sub_category_id") REFERENCES "sub_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctor_qualifications" ADD CONSTRAINT "referral_doctor_qualifications_referral_doctor_id_fkey" FOREIGN KEY ("referral_doctor_id") REFERENCES "referral_doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctor_experience" ADD CONSTRAINT "referral_doctor_experience_referral_doctor_id_fkey" FOREIGN KEY ("referral_doctor_id") REFERENCES "referral_doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctor_lab_tests" ADD CONSTRAINT "referral_doctor_lab_tests_referral_doctor_id_fkey" FOREIGN KEY ("referral_doctor_id") REFERENCES "referral_doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_doctor_lab_panels" ADD CONSTRAINT "referral_doctor_lab_panels_referral_doctor_id_fkey" FOREIGN KEY ("referral_doctor_id") REFERENCES "referral_doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
