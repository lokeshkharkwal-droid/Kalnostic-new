-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "aadhaar_number" TEXT,
ADD COLUMN     "emergency_contact_name" TEXT,
ADD COLUMN     "emergency_contact_number" TEXT,
ADD COLUMN     "father_name" TEXT,
ADD COLUMN     "mother_name" TEXT,
ADD COLUMN     "nationality" TEXT DEFAULT 'Indian',
ADD COLUMN     "pan_number" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "staff_counter" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "user_branch_profiles" ADD COLUMN     "branch_status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "default_module_id" TEXT;

-- CreateTable
CREATE TABLE "tenant_staff_memberships" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "user_type" "UserType" NOT NULL DEFAULT 'INTERNAL',
    "role_key" TEXT NOT NULL,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tenant_staff_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_modules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_permissions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "set_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_branch_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_staff_memberships_tenant_id_idx" ON "tenant_staff_memberships"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_staff_memberships_person_id_idx" ON "tenant_staff_memberships"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_staff_memberships_tenant_id_person_id_key" ON "tenant_staff_memberships"("tenant_id", "person_id");

-- CreateIndex
CREATE INDEX "branch_modules_tenant_id_idx" ON "branch_modules"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_modules_branch_id_idx" ON "branch_modules"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_modules_branch_id_module_key_key" ON "branch_modules"("branch_id", "module_key");

-- CreateIndex
CREATE INDEX "user_branch_permissions_tenant_id_person_id_idx" ON "user_branch_permissions"("tenant_id", "person_id");

-- CreateIndex
CREATE INDEX "user_branch_permissions_branch_id_idx" ON "user_branch_permissions"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branch_permissions_tenant_id_person_id_branch_id_permi_key" ON "user_branch_permissions"("tenant_id", "person_id", "branch_id", "permission_key");
