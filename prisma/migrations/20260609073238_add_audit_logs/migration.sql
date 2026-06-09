-- CreateEnum
CREATE TYPE "AuditModule" AS ENUM ('USER', 'BRANCH', 'SCHEDULE', 'TENANT', 'AUTH', 'SITEADMIN');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'OTHER');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT,
    "module" "AuditModule" NOT NULL,
    "action" "AuditAction" NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL,
    "actor_person_id" TEXT NOT NULL,
    "actor_role_key" TEXT,
    "actor_role_label" TEXT,
    "ip_address" TEXT,
    "resource_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_branch_id_idx" ON "audit_logs"("branch_id");

-- CreateIndex
CREATE INDEX "audit_logs_module_idx" ON "audit_logs"("module");

-- CreateIndex
CREATE INDEX "audit_logs_actor_person_id_idx" ON "audit_logs"("actor_person_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_deleted_at_idx" ON "audit_logs"("deleted_at");
