-- Discard / Return conditions for a later Retrieve (Sample Search requirements, 2026-11-06).
--
-- `is_recoverable`: whether a Discarded sample can still be recovered. Set when the sample is
-- discarded, editable while it stays Discarded; Retrieve out of Discarded needs it true.
-- `returned_verified_at/by`: staff confirmation that a Returned sample is physically back and
-- checked; Retrieve out of Returned needs it.
-- All three are nullable and additive: existing rows keep NULL (not recoverable / not verified), so a
-- sample discarded or returned before this change has to be flagged before it can be retrieved.
ALTER TABLE "order_samples"
  ADD COLUMN "is_recoverable" BOOLEAN,
  ADD COLUMN "returned_verified_at" TIMESTAMP(3),
  ADD COLUMN "returned_verified_by" TEXT;
