-- Background "Import Master Data" jobs (Tenant → Branch Master Data) so the
-- branch-admin dialog can poll live progress. New table only — nothing existing
-- changes. Idempotent (guarded type, IF NOT EXISTS, DROP POLICY IF EXISTS), and
-- mirrors the block added to prisma/rls.sql.
--
-- Rollback: DROP TABLE master_data_import_jobs; DROP TYPE "MasterDataImportJobStatus";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MasterDataImportJobStatus') THEN
    CREATE TYPE "MasterDataImportJobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "master_data_import_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "status" "MasterDataImportJobStatus" NOT NULL DEFAULT 'RUNNING',
    "progress" JSONB NOT NULL,
    "result" JSONB,
    "error" JSONB,
    "started_by" TEXT,
    "runner" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "master_data_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "master_data_import_jobs_tenant_id_branch_id_created_at_idx"
  ON "master_data_import_jobs" ("tenant_id", "branch_id", "created_at");

-- ── master_data_import_jobs ──
ALTER TABLE master_data_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_data_import_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_data_import_jobs_tenant_isolation ON master_data_import_jobs;
CREATE POLICY master_data_import_jobs_tenant_isolation ON master_data_import_jobs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
-- At most one RUNNING import per tenant (imports run one at a time to keep DB load bounded).
CREATE UNIQUE INDEX IF NOT EXISTS master_data_import_jobs_one_running_per_tenant
  ON master_data_import_jobs (tenant_id) WHERE status = 'RUNNING';
