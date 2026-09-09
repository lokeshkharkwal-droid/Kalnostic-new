-- New "Result Suggestion" / "Default Value" parameter options
-- (Add Multiple Results dialog -> Configure: New Parameter). Suggestions are
-- entered one per line in the UI, stored as a plain text array; the default
-- value is a single string, matching the existing nullable-scalar columns on
-- this table (e.g. allowable_units, notes).
ALTER TABLE "lab_test_result_params" ADD COLUMN "result_suggestions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "lab_test_result_params" ADD COLUMN "default_value" TEXT;
