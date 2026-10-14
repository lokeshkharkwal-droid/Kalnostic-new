-- Wire the test-level "Bill Only Test" and "Sample Flow" flags end-to-end.
--
-- Until now isBillOnlyTest/isSampleFlow lived only on the master `lab_test`
-- (and were explicitly dropped on import into a branch), so the order/billing/
-- accession pipeline — which runs on the branch snapshots — could never read
-- them. This migration:
--   1) mirrors both flags onto branch_lab_tests, lab_panels, branch_lab_panels
--      so the workflow can honour them for tests AND panels;
--   2) flips the Sample Flow default to TRUE (normal collection flow) so a new
--      test/panel follows accession → collection unless explicitly set to No;
--   3) backfills every existing row's is_sample_flow to TRUE — the flag was
--      inert before enforcement, so prior values carry no operational intent and
--      "normal flow" is the correct baseline.
-- New is_bill_only_test columns default FALSE (opt-in).

-- 1. branch_lab_tests
ALTER TABLE "branch_lab_tests" ADD COLUMN "is_bill_only_test" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "branch_lab_tests" ADD COLUMN "is_sample_flow" BOOLEAN NOT NULL DEFAULT true;

-- 2. lab_panels
ALTER TABLE "lab_panels" ADD COLUMN "is_bill_only_test" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lab_panels" ADD COLUMN "is_sample_flow" BOOLEAN NOT NULL DEFAULT true;

-- 3. branch_lab_panels
ALTER TABLE "branch_lab_panels" ADD COLUMN "is_bill_only_test" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "branch_lab_panels" ADD COLUMN "is_sample_flow" BOOLEAN NOT NULL DEFAULT true;

-- 4. lab_test: flip the default to TRUE and backfill existing rows.
ALTER TABLE "lab_test" ALTER COLUMN "is_sample_flow" SET DEFAULT true;
UPDATE "lab_test" SET "is_sample_flow" = true WHERE "is_sample_flow" = false;
