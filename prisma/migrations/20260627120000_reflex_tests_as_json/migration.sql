-- Replace the relational `reflex_test_ids` array with a JSON snapshot column.
-- (Dev data in the dropped column is discarded.)
ALTER TABLE "lab_test_result_params" DROP COLUMN "reflex_test_ids";
ALTER TABLE "lab_test_result_params" ADD COLUMN "reflex_tests" JSONB NOT NULL DEFAULT '[]';
