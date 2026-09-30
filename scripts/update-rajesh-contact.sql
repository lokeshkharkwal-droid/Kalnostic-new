-- Update Rajesh's mobile + email (persons + person_credentials) in one transaction.
-- Aborts and rolls back unless exactly one person matches and the new values are free.
--
-- Dry run (shows the change, then rolls back):
--   psql "<url>" -v ON_ERROR_STOP=1 -v dry_run=1 -f update-rajesh-contact.sql
-- Apply for real:
--   psql "<url>" -v ON_ERROR_STOP=1 -f update-rajesh-contact.sql

\set old_phone '9160036283'
\set old_email 'rajeshdega@yahoo.com'
\set new_phone '9160036282'
\set new_email 'rajeshdega2@yahoo.com'

\echo '=== BEFORE ==='
SELECT p.id, p.first_name, p.phone, p.email, c.phone AS login_phone, c.email AS login_email
FROM persons p LEFT JOIN person_credentials c ON c.person_id = p.id
WHERE p.phone = :'old_phone' OR p.email = :'old_email';

BEGIN;

SELECT set_config('fix.old_phone', :'old_phone', true),
       set_config('fix.old_email', :'old_email', true),
       set_config('fix.new_phone', :'new_phone', true),
       set_config('fix.new_email', :'new_email', true) \g /dev/null

DO $$
DECLARE
  old_phone text := current_setting('fix.old_phone');
  old_email text := current_setting('fix.old_email');
  new_phone text := current_setting('fix.new_phone');
  new_email text := current_setting('fix.new_email');
  v_id persons.id%TYPE;
  v_n  int;
BEGIN
  SELECT count(*) INTO v_n FROM persons WHERE phone = old_phone OR email = old_email;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 matching person, found %. Nothing changed.', v_n;
  END IF;
  SELECT id INTO v_id FROM persons WHERE phone = old_phone OR email = old_email;

  IF EXISTS (SELECT 1 FROM persons
             WHERE (phone = new_phone OR email = new_email) AND id <> v_id) THEN
    RAISE EXCEPTION 'New phone/email already belongs to another person. Nothing changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM person_credentials
             WHERE (phone = new_phone OR email = new_email) AND person_id <> v_id) THEN
    RAISE EXCEPTION 'New phone/email already used as another login. Nothing changed.';
  END IF;

  UPDATE persons SET phone = new_phone, email = new_email WHERE id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'persons update touched % rows, expected 1. Nothing changed.', v_n;
  END IF;

  -- Only replace login identifiers that are already set, so we don't add a
  -- new login method the user didn't have before.
  UPDATE person_credentials
  SET phone = CASE WHEN phone IS NULL THEN NULL ELSE new_phone END,
      email = CASE WHEN email IS NULL THEN NULL ELSE new_email END
  WHERE person_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RAISE NOTICE 'Updated person % (person_credentials rows: %)', v_id, v_n;
END $$;

\echo '=== AFTER ==='
SELECT p.id, p.first_name, p.phone, p.email, c.phone AS login_phone, c.email AS login_email
FROM persons p LEFT JOIN person_credentials c ON c.person_id = p.id
WHERE p.phone = :'new_phone' OR p.email = :'new_email';

\if :{?dry_run}
  ROLLBACK;
  \echo '*** DRY RUN: rolled back, nothing saved ***'
\else
  COMMIT;
  \echo '*** COMMITTED ***'
\endif
