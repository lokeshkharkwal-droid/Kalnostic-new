-- Backfill patient-portal logins for patients registered BEFORE auto-onboarding
-- (PatientOnboardingService, `patient.created`) existed.
--
-- For every active, non-family-member patient that has a usable login identifier
-- (a valid 10-digit mobile, or an email) this does exactly what
-- `PatientCredentialService.ensureLoginCredentials` does for a new patient:
--   1. links the patient to a platform `persons` row (reusing the person that
--      already owns the phone — else the email — otherwise creating one), and
--      sets persons.is_patient = true;
--   2. creates `person_credentials` (temp password, must be changed on first
--      login) ONLY when the person has none — an existing login, e.g. a staff
--      member's, is never overwritten or re-issued;
--   3. upserts the platform-level `person_tenant_enrollments` row that drives
--      the portal's business list (an existing row is never changed/revived).
--
-- Idempotent: re-running links nothing twice, creates no second credentials row
-- and no second enrolment.
--
-- Deliberately NOT done:
--   * No email / SMS is sent. Patients are not told about their login by this
--     migration. The temp password is the app's fixed PATIENT_TEMP_PASSWORD
--     ('Password@123'), so communicate it through a controlled channel; every
--     backfilled login is flagged is_temp_password = true and the portal forces a
--     password change before anything else is reachable.
--   * Family members (is_family_member) get no login of their own — they are
--     viewed through the head's session via PatientFamilyLink.
--   * Patients with no valid mobile and no email are skipped (no identifier).
--   * Inactive / soft-deleted patients are skipped, as are patients whose
--     phone/email already belongs to a SOFT-DELETED person (the unique index
--     covers deleted rows; reusing it would resurrect a removed identity).
--
-- ROW-LEVEL SECURITY: `patients` has FORCE ROW LEVEL SECURITY, so a migration role
-- that is not a superuser / BYPASSRLS would see ZERO rows. The work therefore runs
-- once per tenant with `app.current_tenant_id` set exactly as the app does
-- (PrismaService.withTenant), every patient read is also filtered on the tenant,
-- and the setting is cleared at the end. persons / person_credentials /
-- person_tenant_enrollments are platform-level (no RLS).
--
-- LOCKING: this file deliberately contains NO ALTER TABLE.

DO $backfill$
DECLARE
  -- bcrypt(cost 12) of the app's PATIENT_TEMP_PASSWORD (verified with bcrypt.compare).
  temp_hash CONSTANT text := '$2b$12$/7k6VFAZUN9l3MvvXnllue9DAOvLSQf0.tYPXYJOxNpri8Kfyq8ce';
  t_id text;
  p record;
  digits text;
  v_phone text;
  v_email text;
  v_pid text;
  v_pdeleted timestamp;
  v_cphone text;
  v_cemail text;
  n_linked bigint := 0;
  n_created bigint := 0;
  n_creds bigint := 0;
  n_enrol bigint := 0;
  n_skip_noid bigint := 0;
  n_skip_deleted bigint := 0;
BEGIN
  FOR t_id IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.current_tenant_id', t_id, true);

    FOR p IN
      SELECT "id", "person_id", "branch_id", "mobile", "email", "salutation",
             "first_name", "middle_name", "last_name", "gender", "blood_group",
             "date_of_birth"
        FROM "patients"
       WHERE "tenant_id" = t_id
         AND "deleted_at" IS NULL
         AND "is_active" = true
         AND "is_family_member" = false
       ORDER BY "created_at", "id"
    LOOP
      -- Normalise exactly like src/common/utils/phone.util.ts: digits only, last
      -- 10 when longer; usable only if it matches ^[6-9][0-9]{9}$.
      digits := regexp_replace(coalesce(p."mobile", ''), '\D', '', 'g');
      IF length(digits) > 10 THEN
        digits := right(digits, 10);
      END IF;
      v_phone := CASE WHEN digits ~ '^[6-9][0-9]{9}$' THEN digits ELSE NULL END;
      v_email := nullif(btrim(coalesce(p."email", '')), '');

      v_pid := p."person_id";

      IF v_pid IS NULL THEN
        IF v_phone IS NULL AND v_email IS NULL THEN
          n_skip_noid := n_skip_noid + 1;
          CONTINUE;
        END IF;

        -- Reuse the person that owns the phone, else the one that owns the email.
        v_pid := NULL;
        v_pdeleted := NULL;
        IF v_phone IS NOT NULL THEN
          SELECT "id", "deleted_at" INTO v_pid, v_pdeleted
            FROM "persons" WHERE "phone" = v_phone;
        END IF;
        IF v_pid IS NULL AND v_email IS NOT NULL THEN
          SELECT "id", "deleted_at" INTO v_pid, v_pdeleted
            FROM "persons" WHERE "email" = v_email;
        END IF;

        IF v_pid IS NOT NULL AND v_pdeleted IS NOT NULL THEN
          n_skip_deleted := n_skip_deleted + 1;
          CONTINUE;
        END IF;

        IF v_pid IS NULL THEN
          INSERT INTO "persons" (
            "id", "platform_mrn", "salutation", "first_name", "middle_name",
            "last_name", "date_of_birth", "gender", "blood_group", "phone", "email",
            "owner_tenant_id", "is_patient", "is_active", "created_at", "updated_at"
          ) VALUES (
            gen_random_uuid()::text,
            'KAL-' || to_char(now(), 'YYYYMMDD') || '-' ||
              upper(substr(md5(gen_random_uuid()::text), 1, 8)),
            p."salutation"::text, p."first_name", p."middle_name", p."last_name",
            p."date_of_birth", p."gender", p."blood_group",
            v_phone,
            -- the email may already belong to another person (matched above only
            -- when the phone was absent); never create a duplicate email.
            CASE WHEN v_email IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM "persons" WHERE "email" = v_email)
                 THEN v_email ELSE NULL END,
            t_id, true, true, now(), now()
          ) RETURNING "id" INTO v_pid;
          n_created := n_created + 1;
        END IF;

        UPDATE "patients" SET "person_id" = v_pid
         WHERE "id" = p."id" AND "tenant_id" = t_id AND "person_id" IS NULL;
        n_linked := n_linked + 1;
      END IF;

      UPDATE "persons" SET "is_patient" = true, "updated_at" = now()
       WHERE "id" = v_pid AND "is_patient" = false;

      -- Credentials: only when the person has none.
      IF NOT EXISTS (SELECT 1 FROM "person_credentials" WHERE "person_id" = v_pid) THEN
        SELECT "phone", "email" INTO v_cphone, v_cemail
          FROM "persons" WHERE "id" = v_pid;
        -- person_credentials.phone / .email are unique too — drop a conflicting one.
        IF v_cphone IS NOT NULL AND EXISTS (
          SELECT 1 FROM "person_credentials" WHERE "phone" = v_cphone) THEN
          v_cphone := NULL;
        END IF;
        IF v_cemail IS NOT NULL AND EXISTS (
          SELECT 1 FROM "person_credentials" WHERE "email" = v_cemail) THEN
          v_cemail := NULL;
        END IF;
        IF v_cphone IS NOT NULL OR v_cemail IS NOT NULL THEN
          INSERT INTO "person_credentials" (
            "id", "person_id", "phone", "email", "password_hash",
            "is_temp_password", "created_at", "updated_at"
          ) VALUES (
            gen_random_uuid()::text, v_pid, v_cphone, v_cemail, temp_hash,
            true, now(), now()
          );
          n_creds := n_creds + 1;
        END IF;
      END IF;

      -- Enrolment: never touch an existing (person, tenant) row.
      INSERT INTO "person_tenant_enrollments" (
        "id", "person_id", "tenant_id", "branch_id", "enrolled_at", "enrolled_by",
        "created_at", "updated_at"
      ) VALUES (
        gen_random_uuid()::text, v_pid, t_id, p."branch_id", now(),
        'migration-backfill', now(), now()
      ) ON CONFLICT ("person_id", "tenant_id") DO NOTHING;
      IF FOUND THEN
        n_enrol := n_enrol + 1;
      END IF;
    END LOOP;
  END LOOP;

  PERFORM set_config('app.current_tenant_id', '', true);
  RAISE NOTICE 'patient-portal login backfill: % patients linked to a person (% new persons), % credentials created, % enrolments added; skipped % (no phone/email), % (soft-deleted person)',
    n_linked, n_created, n_creds, n_enrol, n_skip_noid, n_skip_deleted;
END
$backfill$;
