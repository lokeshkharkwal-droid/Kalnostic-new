-- Re-run with a fresh sample (Technician + Accession).
--
-- Additive only: every new column is nullable or has a default, so existing rows and the
-- existing Repeat / Re-run behave exactly as before.
--
--  * re_run_requests.sample_mode      SAME (default) | FRESH  - how the re-run is carried out
--  * re_run_requests.repeat_batch_id  the batch tag of the sample rows repeated by a FRESH re-run
--  * order_samples.repeat_batch_id    set on rows sent back for a fresh collection; part of the barcode
--                                     group key so the repeated rows get their own new barcode/group

CREATE TYPE "ReRunSampleMode" AS ENUM ('SAME', 'FRESH');

ALTER TABLE "re_run_requests"
  ADD COLUMN "sample_mode" "ReRunSampleMode" NOT NULL DEFAULT 'SAME',
  ADD COLUMN "repeat_batch_id" TEXT;

ALTER TABLE "order_samples"
  ADD COLUMN "repeat_batch_id" TEXT;
