-- CreateEnum
CREATE TYPE "DoctorBranchRole" AS ENUM ('RESIDENT', 'VISITING');

-- CreateEnum
CREATE TYPE "DoctorAvailability" AS ENUM ('FULL_TIME', 'PART_TIME');

-- AlterTable
ALTER TABLE "doctors" DROP COLUMN "consultation_fee",
DROP COLUMN "emergency_fee",
DROP COLUMN "follow_up_fee",
DROP COLUMN "is_allow_discount";

-- CreateTable
CREATE TABLE "doctor_branch_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "branch_role" "DoctorBranchRole" NOT NULL,
    "availability" "DoctorAvailability" NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "consultation_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "emergency_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "follow_up_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_allow_discount" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "doctor_branch_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doctor_branch_assignments_tenant_id_idx" ON "doctor_branch_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_branch_assignments_doctor_id_idx" ON "doctor_branch_assignments"("doctor_id");

-- CreateIndex
CREATE INDEX "doctor_branch_assignments_branch_id_idx" ON "doctor_branch_assignments"("branch_id");

-- CreateIndex
CREATE INDEX "doctor_branch_assignments_deleted_at_idx" ON "doctor_branch_assignments"("deleted_at");

-- AddForeignKey
ALTER TABLE "doctor_branch_assignments" ADD CONSTRAINT "doctor_branch_assignments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_branch_assignments" ADD CONSTRAINT "doctor_branch_assignments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

