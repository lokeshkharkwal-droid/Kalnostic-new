-- Background "Sync from Master Data" jobs for a branch's Lab Test / Lab Panel
-- List (reconcile the list against Branch Master Data) so the branch-admin
-- dialog can poll live progress — mirrors master_data_import_jobs, one table for
-- both kinds (`kind`). New table only — nothing existing changes. Idempotent
-- (guarded type, IF NOT EXISTS, DROP POLICY IF EXISTS), and mirrors the block
-- added to prisma/rls.sql. Reuses the existing "MasterDataImportJobStatus" enum.
--
-- Rollback: DROP TABLE branch_list_sync_jobs; DROP TYPE "BranchListSyncKind";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BranchListSyncKind') THEN
    CREATE TYPE "BranchListSyncKind" AS ENUM ('LAB_TEST', 'LAB_PANEL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "branch_list_sync_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "kind" "BranchListSyncKind" NOT NULL,
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
    CONSTRAINT "branch_list_sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "branch_list_sync_jobs_tenant_id_branch_id_created_at_idx"
  ON "branch_list_sync_jobs" ("tenant_id", "branch_id", "created_at");

-- ── branch_list_sync_jobs ──
ALTER TABLE branch_list_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_list_sync_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS branch_list_sync_jobs_tenant_isolation ON branch_list_sync_jobs;
CREATE POLICY branch_list_sync_jobs_tenant_isolation ON branch_list_sync_jobs
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
-- At most one RUNNING sync per branch per list kind (a test-list and a panel-list
-- sync may run together; two of the same kind on one branch may not).
CREATE UNIQUE INDEX IF NOT EXISTS branch_list_sync_jobs_one_running_per_branch_kind
  ON branch_list_sync_jobs (tenant_id, branch_id, kind) WHERE status = 'RUNNING';
