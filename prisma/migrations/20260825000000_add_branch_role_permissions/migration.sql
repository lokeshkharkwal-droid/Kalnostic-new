-- CreateTable
CREATE TABLE "branch_role_permissions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "auth_role_id" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "set_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "branch_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_role_permissions_tenant_id_branch_id_auth_role_id_idx" ON "branch_role_permissions"("tenant_id", "branch_id", "auth_role_id");

-- CreateIndex
CREATE INDEX "branch_role_permissions_branch_id_idx" ON "branch_role_permissions"("branch_id");

-- CreateIndex
CREATE INDEX "branch_role_permissions_auth_role_id_idx" ON "branch_role_permissions"("auth_role_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_role_permissions_tenant_id_branch_id_auth_role_id_pe_key" ON "branch_role_permissions"("tenant_id", "branch_id", "auth_role_id", "permission_key");

-- AddForeignKey
ALTER TABLE "branch_role_permissions" ADD CONSTRAINT "branch_role_permissions_auth_role_id_fkey" FOREIGN KEY ("auth_role_id") REFERENCES "auth_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
