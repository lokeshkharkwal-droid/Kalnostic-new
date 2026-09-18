-- CreateEnum
CREATE TYPE "OverallResultTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable: Business Admin "Overall Results" content-template library.
-- `group_name` is free text, matching the same convention as
-- lab_test_result_params.group_name (string equality, no FK) so a template can
-- later be associated with any test whose result-parameter group shares this
-- name. Report-time consumption is a future phase.
CREATE TABLE "overall_result_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "OverallResultTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "overall_result_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "overall_result_templates_tenant_id_idx" ON "overall_result_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "overall_result_templates_group_name_idx" ON "overall_result_templates"("group_name");

-- CreateIndex
CREATE INDEX "overall_result_templates_deleted_at_idx" ON "overall_result_templates"("deleted_at");

-- RowLevelSecurity + partial unique index (see prisma/rls.sql for the
-- authoritative, re-runnable copy of these statements).
ALTER TABLE "overall_result_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "overall_result_templates" FORCE ROW LEVEL SECURITY;

CREATE POLICY "overall_result_templates_tenant_isolation" ON "overall_result_templates"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE UNIQUE INDEX "overall_result_templates_name_active_unique"
  ON "overall_result_templates" (tenant_id, name)
  WHERE deleted_at IS NULL;
