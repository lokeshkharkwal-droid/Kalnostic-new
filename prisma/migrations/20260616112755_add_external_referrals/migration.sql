-- CreateEnum
CREATE TYPE "ExternalReferralStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "InternalReferralStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CommissionMode" AS ENUM ('INCLUDED_IN_SALARY', 'SEPARATE_PAYOUT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditModule" ADD VALUE 'EXTERNAL_REFERRAL';
ALTER TYPE "AuditModule" ADD VALUE 'INTERNAL_REFERRAL';

-- CreateTable
CREATE TABLE "external_referrals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organisation_name" TEXT,
    "referral_code" TEXT,
    "status" "ExternalReferralStatus" NOT NULL DEFAULT 'ACTIVE',
    "mobile_number" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pin_code" TEXT,
    "pan_number" TEXT,
    "aadhaar_number" TEXT,
    "gst_number" TEXT,
    "account_holder_name" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "ifsc_code" TEXT,
    "is_commission_applicable" BOOLEAN NOT NULL DEFAULT false,
    "commission_type" "CommissionType",
    "commission_pct_lab_test" DECIMAL(5,2),
    "commission_pct_lab_panel" DECIMAL(5,2),
    "commission_slabs" JSONB NOT NULL DEFAULT '[]',
    "fixed_commission_cycle" "FixedCommissionCycle",
    "fixed_amount" DECIMAL(10,2),
    "is_tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "payment_cycle" "PaymentCycle" NOT NULL DEFAULT 'NA',
    "payment_mode" "ReferralPaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "monthly_target_amount" INTEGER NOT NULL DEFAULT 0,
    "is_incentive_bonus_applicable" BOOLEAN NOT NULL DEFAULT false,
    "bonus_slabs" JSONB NOT NULL DEFAULT '[]',
    "file_name" TEXT,
    "file_url" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "external_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_referral_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_referral_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "external_referral_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_referral_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_referral_id" TEXT NOT NULL,
    "lab_panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "external_referral_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_referrals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "full_name" TEXT,
    "designation" TEXT,
    "joining_date" DATE,
    "mobile_number" TEXT,
    "email" TEXT,
    "is_commission_applicable" BOOLEAN NOT NULL DEFAULT false,
    "commission_type" "CommissionType",
    "commission_pct_lab_test" DECIMAL(5,2),
    "commission_pct_lab_panel" DECIMAL(5,2),
    "commission_slabs" JSONB NOT NULL DEFAULT '[]',
    "fixed_commission_cycle" "FixedCommissionCycle",
    "fixed_amount" DECIMAL(10,2),
    "is_tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "is_included_in_payroll" BOOLEAN NOT NULL DEFAULT false,
    "payment_cycle" "PaymentCycle" NOT NULL DEFAULT 'MONTHLY',
    "payment_mode" "ReferralPaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "commission_mode" "CommissionMode" NOT NULL DEFAULT 'INCLUDED_IN_SALARY',
    "monthly_target_amount" INTEGER NOT NULL DEFAULT 0,
    "is_incentive_bonus_applicable" BOOLEAN NOT NULL DEFAULT false,
    "bonus_slabs" JSONB NOT NULL DEFAULT '[]',
    "file_name" TEXT,
    "file_url" TEXT,
    "remarks" TEXT,
    "status" "InternalReferralStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "internal_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_referral_lab_tests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "internal_referral_id" TEXT NOT NULL,
    "lab_test_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "internal_referral_lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_referral_lab_panels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "internal_referral_id" TEXT NOT NULL,
    "lab_panel_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "internal_referral_lab_panels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_referrals_tenant_id_idx" ON "external_referrals"("tenant_id");

-- CreateIndex
CREATE INDEX "external_referrals_status_idx" ON "external_referrals"("status");

-- CreateIndex
CREATE INDEX "external_referrals_deleted_at_idx" ON "external_referrals"("deleted_at");

-- CreateIndex
CREATE INDEX "external_referral_lab_tests_tenant_id_idx" ON "external_referral_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_tests_external_referral_id_idx" ON "external_referral_lab_tests"("external_referral_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_tests_lab_test_id_idx" ON "external_referral_lab_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_tests_deleted_at_idx" ON "external_referral_lab_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "external_referral_lab_panels_tenant_id_idx" ON "external_referral_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_panels_external_referral_id_idx" ON "external_referral_lab_panels"("external_referral_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_panels_lab_panel_id_idx" ON "external_referral_lab_panels"("lab_panel_id");

-- CreateIndex
CREATE INDEX "external_referral_lab_panels_deleted_at_idx" ON "external_referral_lab_panels"("deleted_at");

-- CreateIndex
CREATE INDEX "internal_referrals_tenant_id_idx" ON "internal_referrals"("tenant_id");

-- CreateIndex
CREATE INDEX "internal_referrals_employee_id_idx" ON "internal_referrals"("employee_id");

-- CreateIndex
CREATE INDEX "internal_referrals_status_idx" ON "internal_referrals"("status");

-- CreateIndex
CREATE INDEX "internal_referrals_deleted_at_idx" ON "internal_referrals"("deleted_at");

-- CreateIndex
CREATE INDEX "internal_referral_lab_tests_tenant_id_idx" ON "internal_referral_lab_tests"("tenant_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_tests_internal_referral_id_idx" ON "internal_referral_lab_tests"("internal_referral_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_tests_lab_test_id_idx" ON "internal_referral_lab_tests"("lab_test_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_tests_deleted_at_idx" ON "internal_referral_lab_tests"("deleted_at");

-- CreateIndex
CREATE INDEX "internal_referral_lab_panels_tenant_id_idx" ON "internal_referral_lab_panels"("tenant_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_panels_internal_referral_id_idx" ON "internal_referral_lab_panels"("internal_referral_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_panels_lab_panel_id_idx" ON "internal_referral_lab_panels"("lab_panel_id");

-- CreateIndex
CREATE INDEX "internal_referral_lab_panels_deleted_at_idx" ON "internal_referral_lab_panels"("deleted_at");

-- AddForeignKey
ALTER TABLE "external_referral_lab_tests" ADD CONSTRAINT "external_referral_lab_tests_external_referral_id_fkey" FOREIGN KEY ("external_referral_id") REFERENCES "external_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_referral_lab_panels" ADD CONSTRAINT "external_referral_lab_panels_external_referral_id_fkey" FOREIGN KEY ("external_referral_id") REFERENCES "external_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_referral_lab_tests" ADD CONSTRAINT "internal_referral_lab_tests_internal_referral_id_fkey" FOREIGN KEY ("internal_referral_id") REFERENCES "internal_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_referral_lab_panels" ADD CONSTRAINT "internal_referral_lab_panels_internal_referral_id_fkey" FOREIGN KEY ("internal_referral_id") REFERENCES "internal_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
