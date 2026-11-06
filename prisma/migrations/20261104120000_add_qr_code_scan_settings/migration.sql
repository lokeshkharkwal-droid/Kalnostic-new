-- Branch Admin › Branch Settings › QR Code Scan Settings. Per-branch rules for
-- what a patient may open/print after scanning the QR code on their bill or
-- report. Tenant-scoped + branch-level (CLAUDE.md §4.6): one row per branch,
-- created on first read. The values are read by the QR-scan print path.

-- AlterEnum
ALTER TYPE "AuditModule" ADD VALUE 'QR_CODE_SCAN_SETTINGS';

-- CreateTable
CREATE TABLE "qr_code_scan_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "bill_printable_payment_statuses" "PaymentStatus"[] DEFAULT ARRAY['PAID']::"PaymentStatus"[],
    "bill_print_template_id" TEXT,
    "report_print_template_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "qr_code_scan_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qr_code_scan_settings_tenant_id_idx" ON "qr_code_scan_settings"("tenant_id");
CREATE INDEX "qr_code_scan_settings_branch_id_idx" ON "qr_code_scan_settings"("branch_id");
CREATE UNIQUE INDEX "qr_code_scan_settings_tenant_id_branch_id_key" ON "qr_code_scan_settings"("tenant_id", "branch_id");

-- ── Row-Level Security (mirrors prisma/rls.sql) ──────────────────────────────────
-- Runs after 1_row_level_security so current_tenant_id() already exists.
ALTER TABLE "qr_code_scan_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qr_code_scan_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qr_code_scan_settings_tenant_isolation ON "qr_code_scan_settings";
CREATE POLICY qr_code_scan_settings_tenant_isolation ON "qr_code_scan_settings"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
