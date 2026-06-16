-- CreateEnum
CREATE TYPE "DoctorType" AS ENUM ('REPORTING', 'CONSULTANT');

-- CreateEnum
CREATE TYPE "Salutation" AS ENUM ('DR', 'MR', 'MRS', 'MS', 'PROF');

-- CreateEnum
CREATE TYPE "DoctorPaymentMode" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE');

-- CreateEnum
CREATE TYPE "DoctorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'DOCTOR';

-- CreateTable
CREATE TABLE "doctors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_type" "DoctorType" NOT NULL,
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
    "sub_category" TEXT,
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
    "consultation_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "emergency_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "follow_up_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_allow_discount" BOOLEAN NOT NULL DEFAULT false,
    "account_holder_name" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "ifsc_code" TEXT,
    "payment_mode" "DoctorPaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "status" "DoctorStatus" NOT NULL DEFAULT 'ACTIVE',
    "joining_date" DATE,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_qualifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "degree" TEXT,
    "institution" TEXT,
    "year_of_passing" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctor_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_experience" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "organisation" TEXT,
    "role_position" TEXT,
    "from_date" DATE,
    "to_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctor_experience_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctors_tenant_id_idx" ON "doctors"("tenant_id");

-- CreateIndex
CREATE INDEX "doctors_category_id_idx" ON "doctors"("category_id");

-- CreateIndex
CREATE INDEX "doctors_department_id_idx" ON "doctors"("department_id");

-- CreateIndex
CREATE INDEX "doctors_status_idx" ON "doctors"("status");

-- CreateIndex
CREATE INDEX "doctors_deleted_at_idx" ON "doctors"("deleted_at");

-- CreateIndex
CREATE INDEX "doctor_qualifications_tenant_id_idx" ON "doctor_qualifications"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_qualifications_doctor_id_idx" ON "doctor_qualifications"("doctor_id");

-- CreateIndex
CREATE INDEX "doctor_qualifications_deleted_at_idx" ON "doctor_qualifications"("deleted_at");

-- CreateIndex
CREATE INDEX "doctor_experience_tenant_id_idx" ON "doctor_experience"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_experience_doctor_id_idx" ON "doctor_experience"("doctor_id");

-- CreateIndex
CREATE INDEX "doctor_experience_deleted_at_idx" ON "doctor_experience"("deleted_at");

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_qualifications" ADD CONSTRAINT "doctor_qualifications_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_experience" ADD CONSTRAINT "doctor_experience_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
