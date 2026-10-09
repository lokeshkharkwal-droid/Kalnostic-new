-- Adds `sample_transfers.cloned_sample_id`: the destination OrderSample
-- materialised when an INTERNAL transfer is ACCEPTED (RULE 1). Linking the
-- transfer to its clone lets a later Retrieve/recall unwind the clone
-- (soft-delete it + move its lab reports back to the origin branch) instead of
-- leaving a stale sample in the receiving branch's In-House list. Null until the
-- transfer is accepted, and for EXTERNAL/OUTSOURCE transfers (no local clone).

ALTER TABLE "sample_transfers" ADD COLUMN "cloned_sample_id" TEXT;

CREATE INDEX "sample_transfers_cloned_sample_id_idx" ON "sample_transfers"("cloned_sample_id");
