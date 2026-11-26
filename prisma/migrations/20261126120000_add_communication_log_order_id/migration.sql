-- Link each outbound message to the order it is about.
--
-- Why: the Share & Inform pop-up (Order Console) shows a "Past Notifications"
-- list for the selected order, like the legacy "Send Order" modal did. Every
-- Email / SMS / WhatsApp already gets a `communication_logs` row, but nothing
-- recorded which order a row belongs to, so an order's history couldn't be
-- listed. Going forward `CommunicationService.enqueue` stamps `order_id` from the
-- send's order context (manual shares and automatic order notifications). NULL
-- means the message isn't order-related (manual compose, patient / business /
-- user events).
--
-- Plain nullable id, no FK: a log row must outlive its order (orders are
-- soft-deleted), same convention as `recipient_id`. The table's existing tenant
-- RLS policy already covers the new column, so no rls.sql change is needed.
--
-- Rows sent before this change are linked by the separate, data-only migration
-- 20261126120100_backfill_communication_log_order_id, so this DDL's ACCESS
-- EXCLUSIVE lock is released before the (slower) backfill reads the table.

-- AlterTable
ALTER TABLE "communication_logs" ADD COLUMN IF NOT EXISTS "order_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "communication_logs_tenant_id_order_id_idx"
  ON "communication_logs"("tenant_id", "order_id");
