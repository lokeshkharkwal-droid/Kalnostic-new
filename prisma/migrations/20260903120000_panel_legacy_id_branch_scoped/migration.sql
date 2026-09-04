-- Rework the referring-panel legacy-id idempotency key to be PER-BRANCH.
--
-- A legacy EzHealthTrack business-level referring panel is associated with the
-- branches it has commission/pricing rows for (referring_panel_price_detail.
-- branch_id). The migration now creates one ReferralPanel PER associated branch
-- (branch_id set) — or a single tenant-level row (branch_id NULL) when the panel
-- has no branch mapping. So the uniqueness key must include branch_id, and
-- NULLS NOT DISTINCT keeps the tenant-level (NULL branch) case idempotent.
--
-- Source of truth: prisma/rls.sql. Idempotent (drop-then-create).
DROP INDEX IF EXISTS referral_panels_tenant_legacy_id_active_unique;
CREATE UNIQUE INDEX IF NOT EXISTS referral_panels_tenant_legacy_id_active_unique
  ON referral_panels (tenant_id, legacy_id, branch_id) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL AND legacy_id IS NOT NULL;
