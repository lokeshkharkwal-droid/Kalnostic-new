-- Staff → department membership ("Assign Department" on the Users list), split out
-- of `department_person_mappings`. Membership (which departments a user belongs to /
-- their visibility scope) was conflated with report signatories in that shared table,
-- so assigning a department wrongly made a user appear as a signatory. This dedicated
-- table decouples the two. Tenant-scoped, tenant-level (no branch). RLS below mirrors
-- `dpm_tenant_isolation`; both are also kept in prisma/rls.sql (the source of truth).

-- CreateTable
CREATE TABLE "user_department_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_department_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_department_assignments_tenant_id_idx" ON "user_department_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "user_department_assignments_department_id_idx" ON "user_department_assignments"("department_id");

-- CreateIndex
CREATE INDEX "user_department_assignments_person_id_idx" ON "user_department_assignments"("person_id");

-- CreateIndex
CREATE INDEX "user_department_assignments_deleted_at_idx" ON "user_department_assignments"("deleted_at");

-- AddForeignKey
ALTER TABLE "user_department_assignments" ADD CONSTRAINT "user_department_assignments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (tenant isolation) — mirrors prisma/rls.sql
ALTER TABLE "user_department_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_department_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS uda_tenant_isolation ON "user_department_assignments";
CREATE POLICY uda_tenant_isolation ON "user_department_assignments"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
