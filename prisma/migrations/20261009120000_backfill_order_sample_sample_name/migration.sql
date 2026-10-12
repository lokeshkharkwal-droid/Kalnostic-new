-- Backfill order_samples.sample_name for rows created before the column existed.
--
-- sample_name is the name the sample had WHEN THE ORDER WAS PLACED (a snapshot of
-- lab_test_samples.sample_name taken at creation). This migration only writes a
-- name when it can be PROVEN from evidence stored on, or exactly linked to, the
-- row. It never guesses: a row with no such evidence stays NULL, and print then
-- shows an empty {sample_name}.
--
-- Three deterministic passes, best source first. Each only touches rows whose
-- sample_name is blank (NULL, '' or whitespace) and never overwrites a name:
--   Pass 0  the creation-time label (sample_group_label)
--   Pass 1  the exact sample setting the order used (lab_test_sample_id)
--   Pass 2  the frozen config snapshot, matched by that same setting id
-- (An earlier draft had a pass 3 that guessed from "same test + type + container".
-- It was removed: it can write a current or never-ordered name that nobody can
-- detect, and after passes 0-2 it added nothing on the development data.)
--
-- SAFETY CHECK. The passes rest on one fact: the label is `name ?? type ??
-- container ?? 'General'`, so wherever a name is known the label EQUALS it.
-- Before writing anything, the migration CHECKS that fact on this database, for
-- every kind of evidence, and ABORTS (writing nothing) on the first contradiction:
--   1. a stored sample_name that differs from the label;
--   2. a blank row whose exact sample setting still has a name that differs from
--      the label;
--   3. a blank row whose frozen config snapshot (same setting id) has a name that
--      differs from the label.
-- On a database where the fact holds (all development data does) it is a no-op.
-- Consequence: passes 1 and 2 can only ever confirm the label, or recover a real
-- name that is identical to the sample type / container code (which the label
-- alone cannot tell apart from "no name").
--
-- ROW-LEVEL SECURITY: order_samples / lab_test_samples / branch_lab_tests have
-- FORCE ROW LEVEL SECURITY, so a migration role that is not a superuser / BYPASSRLS
-- would otherwise see ZERO rows and "succeed" without backfilling anything (or
-- without checking anything). Both the check and the passes therefore run once
-- per tenant with `app.current_tenant_id` set exactly as the app does
-- (PrismaService.withTenant), and every statement also filters on the tenant.
-- The setting is transaction-local and cleared at the end.
--
-- LOCKING: this file deliberately contains NO ALTER TABLE. Prisma runs a
-- migration file as ONE transaction, and even a no-op `ADD COLUMN IF NOT EXISTS`
-- takes an ACCESS EXCLUSIVE lock that would then block every read and write of
-- order_samples until the whole backfill finished. The column is created by
-- 20261003170000_add_order_sample_sample_name, which runs first.
--
-- "Blank" below means NULL, '' or whitespace only. A name is copied exactly as
-- stored (never trimmed), the same as new order samples store it.

DO $backfill$
DECLARE
  t_id text;
  n bigint;
  bad_named bigint := 0;
  bad_link bigint := 0;
  bad_snapshot bigint := 0;
BEGIN
  -- ── Safety check (read-only; every tenant; before any write) ─────────────────
  FOR t_id IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.current_tenant_id', t_id, true);

    -- Fact 1: a stored name always equals the label (name-first rule since 2026-08-30).
    SELECT count(*) INTO n
    FROM "order_samples" os
    WHERE os."tenant_id" = t_id
      AND btrim(coalesce(os."sample_name", '')) <> ''
      AND os."sample_group_label" IS DISTINCT FROM os."sample_name";
    bad_named := bad_named + n;

    -- Fact 2: where the exact sample setting still has a name, the label equals it.
    SELECT count(*) INTO n
    FROM "order_samples" os
    JOIN "lab_test_samples" lts
      ON lts."id" = os."lab_test_sample_id" AND lts."tenant_id" = t_id
    WHERE os."tenant_id" = t_id
      AND btrim(coalesce(os."sample_name", '')) = ''
      AND btrim(coalesce(lts."sample_name", '')) <> ''
      AND lts."sample_name" IS DISTINCT FROM os."sample_group_label";
    bad_link := bad_link + n;

    -- Fact 3: where a frozen snapshot lists the same setting id with a name, the
    -- label equals it.
    SELECT count(*) INTO n
    FROM (
      SELECT o."id"
      FROM "order_samples" o
      JOIN "branch_lab_tests" b
        ON b."source_lab_test_id" = o."lab_test_id" AND b."tenant_id" = t_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(b."config_snapshot" -> 'samples') = 'array'
             THEN b."config_snapshot" -> 'samples'
             ELSE '[]'::jsonb END
      ) AS s(elem)
      WHERE o."tenant_id" = t_id
        AND btrim(coalesce(o."sample_name", '')) = ''
        AND o."lab_test_id" IS NOT NULL
        AND s.elem ->> 'id' = o."lab_test_sample_id"
        AND btrim(coalesce(s.elem ->> 'sampleName', '')) <> ''
        AND (s.elem ->> 'sampleName') IS DISTINCT FROM o."sample_group_label"
      GROUP BY o."id"
    ) z;
    bad_snapshot := bad_snapshot + n;
  END LOOP;

  IF bad_named > 0 OR bad_link > 0 OR bad_snapshot > 0 THEN
    RAISE EXCEPTION
      'order_samples.sample_name backfill ABORTED, nothing was written: % row(s) have a stored name that differs from their label, % blank row(s) disagree with their exact sample setting, and % blank row(s) disagree with a config snapshot. The label cannot be trusted as the name on this database - investigate before re-running.',
      bad_named, bad_link, bad_snapshot;
  END IF;

  -- ── The passes ───────────────────────────────────────────────────────────────
  FOR t_id IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.current_tenant_id', t_id, true);

    -- Pass 0 — the label written when the sample was created. Since 2026-08-30
    -- (OrderSampleService) `sample_group_label` is `sample name ?? sample type ??
    -- container type ?? 'General'`, written once at creation and never edited
    -- (no code path, request or trigger changes it), so when it is a real name it
    -- IS the name the sample had when it was ordered. A label equal to the sample
    -- type, the raw container code or 'General' is the FALLBACK (no name, or a
    -- name identical to the type - passes 1 and 2 settle which) and is not copied.
    UPDATE "order_samples" os
    SET "sample_name" = os."sample_group_label"
    WHERE os."tenant_id" = t_id
      AND btrim(coalesce(os."sample_name", '')) = ''
      AND os."sample_group_label" IS NOT NULL
      AND btrim(os."sample_group_label") <> ''
      AND os."sample_group_label" <> 'General'
      AND os."sample_group_label" IS DISTINCT FROM os."sample_type"
      AND os."sample_group_label" IS DISTINCT FROM os."container_type"::text;

    -- Pass 1 — exact. order_samples.lab_test_sample_id points at the very setting
    -- row the order used. Setting rows are never edited in place (an edit or
    -- re-import soft-deletes the old row and creates a new one), so that row still
    -- holds the name it had at order time. No deleted_at filter on purpose. This
    -- is what recovers a real name that happens to equal the sample type.
    UPDATE "order_samples" os
    SET "sample_name" = lts."sample_name"
    FROM "lab_test_samples" lts
    WHERE os."tenant_id" = t_id
      AND lts."id" = os."lab_test_sample_id"
      AND lts."tenant_id" = t_id
      AND btrim(coalesce(os."sample_name", '')) = ''
      AND btrim(coalesce(lts."sample_name", '')) <> '';

    -- Pass 2 — exact, by id, from the Lab Test List copies' frozen config snapshot.
    -- "Import Master Data" (tenant -> branch) and the Lab Test Sync HARD-delete and
    -- recreate setting rows, leaving order_samples.lab_test_sample_id dangling. The
    -- branch_lab_tests.config_snapshot taken before that still lists the old setting
    -- ids with their names. Skipped when the snapshots disagree on the name.
    UPDATE "order_samples" os
    SET "sample_name" = x."name"
    FROM (
      SELECT o."id", min(s.elem ->> 'sampleName') AS "name"
      FROM "order_samples" o
      JOIN "branch_lab_tests" b
        ON b."source_lab_test_id" = o."lab_test_id"
       AND b."tenant_id" = t_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(b."config_snapshot" -> 'samples') = 'array'
             THEN b."config_snapshot" -> 'samples'
             ELSE '[]'::jsonb END
      ) AS s(elem)
      WHERE o."tenant_id" = t_id
        AND btrim(coalesce(o."sample_name", '')) = ''
        AND o."lab_test_id" IS NOT NULL
        AND s.elem ->> 'id' = o."lab_test_sample_id"
        AND btrim(coalesce(s.elem ->> 'sampleName', '')) <> ''
      GROUP BY o."id"
      HAVING count(DISTINCT s.elem ->> 'sampleName') = 1
    ) x
    WHERE os."id" = x."id"
      AND os."tenant_id" = t_id
      AND btrim(coalesce(os."sample_name", '')) = '';
  END LOOP;

  PERFORM set_config('app.current_tenant_id', '', true);
END
$backfill$;
