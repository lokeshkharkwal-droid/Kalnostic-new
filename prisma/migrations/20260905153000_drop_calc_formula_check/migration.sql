-- Business decision (2026-09-05): a lab test parameter with parameterType =
-- CALCULATED no longer requires calculationFormula to be filled in — allow it
-- to be saved blank in Add Test, Excel Import, and the database. The
-- corresponding app-layer checks (assertParam / assertImportParam in
-- lab-test.service.ts) were removed in the same change; this drops the DB
-- CHECK constraint that enforced the same rule as a last-resort backstop.
ALTER TABLE "lab_test_result_params" DROP CONSTRAINT IF EXISTS "chk_lab_test_param_calc_formula";
