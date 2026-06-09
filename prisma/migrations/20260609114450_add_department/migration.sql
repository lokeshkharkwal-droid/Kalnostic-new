-- CreateEnum
CREATE TYPE "DepartmentPosition" AS ENUM ('HOD', 'SPECIALIST', 'CONSULTANT', 'MANAGER', 'TECHNICIAN');

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'DEPARTMENT';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "department_counter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "module_mapping" "BranchType"[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_person_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "position" "DepartmentPosition" NOT NULL,
    "is_signatory" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "department_person_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_tenant_id_idx" ON "departments"("tenant_id");

-- CreateIndex
CREATE INDEX "departments_deleted_at_idx" ON "departments"("deleted_at");

-- CreateIndex
CREATE INDEX "department_person_mappings_tenant_id_idx" ON "department_person_mappings"("tenant_id");

-- CreateIndex
CREATE INDEX "department_person_mappings_department_id_idx" ON "department_person_mappings"("department_id");

-- CreateIndex
CREATE INDEX "department_person_mappings_person_id_idx" ON "department_person_mappings"("person_id");

-- CreateIndex
CREATE INDEX "department_person_mappings_deleted_at_idx" ON "department_person_mappings"("deleted_at");

-- AddForeignKey
ALTER TABLE "department_person_mappings" ADD CONSTRAINT "department_person_mappings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
