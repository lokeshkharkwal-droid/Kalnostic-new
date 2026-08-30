-- Rename the AccessionSample model family to OrderSample and switch its
-- generation to one row per (test × required sample). Hand-authored (Prisma
-- migrate diff would DROP/CREATE and lose data) so the rename preserves rows.
--
-- NOTE: `lab_test_sample_id` is added NOT NULL. On a fresh `migrate deploy` the
-- tables are empty at this point, so this is safe. The old rows (if any) were
-- per-tube and are incompatible with the new per-test model; a pre-existing
-- dev database should have its order_samples data cleared before applying.

-- ── 1. Rename tables ────────────────────────────────────────────────────────
ALTER TABLE "accession_samples" RENAME TO "order_samples";
ALTER TABLE "accession_sample_tests" RENAME TO "order_sample_tests";
ALTER TABLE "accession_status_history" RENAME TO "order_sample_status_history";

-- ── 2. Rename primary keys to match the new table names ─────────────────────
ALTER INDEX "accession_samples_pkey" RENAME TO "order_samples_pkey";
ALTER INDEX "accession_sample_tests_pkey" RENAME TO "order_sample_tests_pkey";
ALTER INDEX "accession_status_history_pkey" RENAME TO "order_sample_status_history_pkey";

-- ── 3. New per-test columns on order_samples ────────────────────────────────
ALTER TABLE "order_samples" ADD COLUMN "lab_test_id" TEXT;
ALTER TABLE "order_samples" ADD COLUMN "lab_test_sample_id" TEXT NOT NULL;
ALTER TABLE "order_samples" ADD COLUMN "department_id" TEXT;

CREATE INDEX "order_samples_lab_test_id_idx" ON "order_samples"("lab_test_id");
CREATE INDEX "order_samples_lab_test_sample_id_idx" ON "order_samples"("lab_test_sample_id");
CREATE INDEX "order_samples_department_id_idx" ON "order_samples"("department_id");

-- ── 4. New column on order_sample_tests ─────────────────────────────────────
ALTER TABLE "order_sample_tests" ADD COLUMN "lab_test_id" TEXT;
