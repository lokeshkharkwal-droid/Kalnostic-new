-- Row-Level Security for the EMI (lab-machine interface) compatibility layer
-- (mirrors prisma/rls.sql). Kept separate from the DDL migration, following the
-- repo's row_level_security migration pattern. Idempotent (DROP ... IF EXISTS /
-- CREATE ... IF NOT EXISTS), so re-running the file is safe.

-- ── adapter_results ─────────────────────────────────────────────────────────
-- Raw audit rows for machine result submissions, written inside the adapter's
-- tenant context (set from the authenticating token). Standard tenant isolation.
ALTER TABLE "adapter_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adapter_results" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS adapter_results_tenant_isolation ON "adapter_results";
CREATE POLICY adapter_results_tenant_isolation ON "adapter_results"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ── lab_adapters: machine token lookup ──────────────────────────────────────
-- Machine (EMI) authentication reads an adapter BY ITS TOKEN before any tenant
-- context exists (the machine presents only a TOKEN header — no JWT, so no
-- app.current_tenant_id). This read-only policy lets the emi module resolve the
-- adapter (→ tenantId) by setting `app.adapter_token` for that lookup only. The
-- 64-hex token is the credential; WITH CHECK is omitted so this grants SELECT
-- only, never writes.
DROP POLICY IF EXISTS lab_adapters_token_lookup ON "lab_adapters";
CREATE POLICY lab_adapters_token_lookup ON "lab_adapters"
  FOR SELECT
  USING (
    token IS NOT NULL
    AND token = NULLIF(current_setting('app.adapter_token', true), '')
  );
