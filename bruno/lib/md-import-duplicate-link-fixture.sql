-- Test-database-only fixture for bruno folder 62: give the branch a SECOND,
-- newer test linked to the same tenant test (:src) as an existing branch test.
-- Usage: psql "$TEST_DB_URL" -v bmd=<branch master data id> -v src=<tenant test id> -f <this file>
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE dup ON COMMIT DROP AS
  SELECT * FROM lab_test
  WHERE master_data_id = :'bmd' AND source_master_lab_test_id = :'src' AND deleted_at IS NULL;
DO $$ BEGIN
  IF (SELECT count(*) FROM dup) <> 1 THEN RAISE EXCEPTION 'expected exactly one linked branch test'; END IF;
END $$;
UPDATE dup SET id = gen_random_uuid(), test_name = test_name || ' (dup)',
  test_code = test_code || '-DUP', created_at = now() + interval '1 second', updated_at = now();
INSERT INTO lab_test SELECT * FROM dup;
COMMIT;
