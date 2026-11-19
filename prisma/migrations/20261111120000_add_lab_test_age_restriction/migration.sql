-- Lab test "Age Restriction" (Master Data → Add/Edit Test → Basic Details).
--
-- When is_age_restricted is true the test may only be ordered for a patient
-- whose age on the order date lies inside min_age .. max_age (min inclusive,
-- max covers its whole unit — the same calendar rule as reference ranges).
-- The four bound columns are NULL when the flag is false (= no age limit).
--
-- Mirrored onto branch_lab_tests so Create Order (which runs on the branch
-- snapshots) can enforce it for the test and for any panel containing it.
-- Purely additive: existing rows default to "not restricted".

-- 1. lab_test (tenant + branch Master Data)
ALTER TABLE "lab_test" ADD COLUMN "is_age_restricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lab_test" ADD COLUMN "min_age_value" INTEGER;
ALTER TABLE "lab_test" ADD COLUMN "min_age_unit" "AgeUnit";
ALTER TABLE "lab_test" ADD COLUMN "max_age_value" INTEGER;
ALTER TABLE "lab_test" ADD COLUMN "max_age_unit" "AgeUnit";

-- 2. branch_lab_tests (branch Lab Test List copies)
ALTER TABLE "branch_lab_tests" ADD COLUMN "is_age_restricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "branch_lab_tests" ADD COLUMN "min_age_value" INTEGER;
ALTER TABLE "branch_lab_tests" ADD COLUMN "min_age_unit" "AgeUnit";
ALTER TABLE "branch_lab_tests" ADD COLUMN "max_age_value" INTEGER;
ALTER TABLE "branch_lab_tests" ADD COLUMN "max_age_unit" "AgeUnit";
