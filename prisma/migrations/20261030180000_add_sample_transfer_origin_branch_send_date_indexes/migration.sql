-- Accession transfer queues (Internal / External / Outsourced referral orders):
-- the OUTGOING lists filter on the sending branch (`origin_branch_id`) and the
-- Sent / Forward / Outsource date filters and sort use `send_date`. Neither column
-- was indexed, so each of those queries scanned every transfer row of the tenant.
-- Index-only change: no data is touched, no column is added or altered, and RLS is
-- unaffected (the existing `tenant_id` policy and index still apply).
CREATE INDEX "sample_transfers_origin_branch_id_idx" ON "sample_transfers"("origin_branch_id");

CREATE INDEX "sample_transfers_send_date_idx" ON "sample_transfers"("send_date");
