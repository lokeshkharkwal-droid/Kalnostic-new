-- Abnormal Flag Logic v1.3 — one-time data move. Runs AFTER the columns exist
-- (20261119120100). It changes NO schema, only data, in two steps:
--
-- STEP 1  lab_test_result_params.abnormal_flag_logic
--   The style used to be stored on each reference range and each reference value of a
--   parameter. It now lives on the parameter (and is optional). For every parameter that has
--   no style yet (the column is NULL for all of them when this runs):
--     * all of its live ranges/values carry the SAME style      -> the parameter takes it;
--     * they DISAGREE                                           -> the style most of them carry;
--                                                                  on a tie -> Bold;
--     * it has NO live range and NO live value                  -> stays WITHOUT a style (NULL):
--       there is nothing to compare a reading against, so nothing is ever styled automatically, and a
--       Technician's Highlight starts on the Bold and Red fallback (what the old screen did as well).
--   Before this release a style could only be set on a range or a value, so nobody ever chose one for a
--   parameter itself: there is no choice to preserve or overwrite, and no placeholder is written.
--   UNDERLINE and COLOUR_HIGHLIGHT are real styles and are copied as they are.
--   The old range/value columns are left untouched (dropped by a later clean-up migration).
--   To list the parameters that had DISAGREEING styles for an admin to review, run (per tenant, with
--   app.current_tenant_id set) the query:
--         SELECT p.id, p.parameter_name, array_agg(DISTINCT s.style) AS styles
--         FROM lab_test_result_params p
--         JOIN (SELECT param_id, abnormal_flag_logic::text AS style
--                 FROM lab_test_reference_ranges WHERE deleted_at IS NULL
--               UNION ALL
--               SELECT param_id, abnormal_flag_logic::text
--                 FROM lab_test_reference_values WHERE deleted_at IS NULL) s
--           ON s.param_id = p.id
--         WHERE p.deleted_at IS NULL
--         GROUP BY p.id, p.parameter_name HAVING count(DISTINCT s.style) > 1;
--
-- STEP 2  lab_report_result_values.flag_option
--   Every row starts as DEFAULT. A row whose technician had ticked "Highlight in Report"
--   (highlight_in_report = true) becomes HIGHLIGHT, keeping its highlight_logic style, so
--   the printed report is unchanged. Only QUALITATIVE / SEMI_QUANTITATIVE rows are converted:
--   the old print ignored a highlight on a quantitative value, so converting one would
--   change what it prints. Nothing becomes NOT_HIGHLIGHT (that choice did not exist).
--
-- ROW-LEVEL SECURITY: all of these tables have FORCE ROW LEVEL SECURITY, so a migration
-- role that is not a superuser / BYPASSRLS would otherwise see ZERO rows and "succeed"
-- without changing anything. Each tenant is therefore handled under its own tenant
-- context (`app.current_tenant_id`, as PrismaService.withTenant sets it), and every
-- statement also filters on the tenant. SiteAdmin template rows have tenant_id NULL and are
-- handled last with the tenant context cleared. The setting is transaction-local.
--
-- RUN IT ONCE, in the release, before the new code is live. Re-running it right away changes nothing,
-- but a re-run AFTER go-live is not harmless:
--   * step 1 only fills a parameter that still has NO style, so it never overwrites a style and cannot undo a
--     style chosen later in Master Data; but a parameter that an admin deliberately blanked, and that has ranges,
--     would get the style of its ranges again;
--   * step 2 sets every ticked non-quantitative row that is not HIGHLIGHT back to HIGHLIGHT, so a Default / Not
--     Highlight chosen later by a technician on such a row would be overwritten (the old tick stays on the row,
--     because the finished-report backfill needs it to reproduce the old print).

DO $backfill$
DECLARE
  t_id text;
  n bigint;
  params_agreed bigint := 0;
  params_majority bigint := 0;
  params_blank bigint := 0;
  values_converted bigint := 0;
BEGIN
  FOR t_id IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.current_tenant_id', t_id, true);

    -- STEP 1a: parameters whose ranges/values all agree take that style.
    WITH styles AS (
      SELECT r."param_id", r."abnormal_flag_logic"::text AS style
      FROM "lab_test_reference_ranges" r
      WHERE r."tenant_id" = t_id AND r."deleted_at" IS NULL
      UNION ALL
      SELECT v."param_id", v."abnormal_flag_logic"::text
      FROM "lab_test_reference_values" v
      WHERE v."tenant_id" = t_id AND v."deleted_at" IS NULL
    ), agreed AS (
      SELECT "param_id", min(style) AS style
      FROM styles
      GROUP BY "param_id"
      HAVING count(DISTINCT style) = 1
    )
    UPDATE "lab_test_result_params" p
       SET "abnormal_flag_logic" = a.style::"AbnormalFlag"
      FROM agreed a
     WHERE p."id" = a."param_id"
       AND p."tenant_id" = t_id
       AND p."abnormal_flag_logic" IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    params_agreed := params_agreed + n;

    -- STEP 1b: parameters whose ranges/values DISAGREE take the most common style (Bold on a tie).
    WITH styles AS (
      SELECT r."param_id", r."abnormal_flag_logic"::text AS style
      FROM "lab_test_reference_ranges" r
      WHERE r."tenant_id" = t_id AND r."deleted_at" IS NULL
      UNION ALL
      SELECT v."param_id", v."abnormal_flag_logic"::text
      FROM "lab_test_reference_values" v
      WHERE v."tenant_id" = t_id AND v."deleted_at" IS NULL
    ), counts AS (
      SELECT "param_id", style, count(*) AS c FROM styles GROUP BY "param_id", style
    ), mixed AS (
      SELECT "param_id", max(c) AS top FROM counts
       GROUP BY "param_id" HAVING count(*) > 1
    ), picked AS (
      SELECT m."param_id",
             CASE WHEN (SELECT count(*) FROM counts c2 WHERE c2."param_id" = m."param_id" AND c2.c = m.top) = 1
                  THEN (SELECT c2.style FROM counts c2 WHERE c2."param_id" = m."param_id" AND c2.c = m.top)
                  ELSE 'BOLD_ONLY' END AS style
        FROM mixed m
    )
    UPDATE "lab_test_result_params" p
       SET "abnormal_flag_logic" = picked.style::"AbnormalFlag"
      FROM picked
     WHERE p."id" = picked."param_id"
       AND p."tenant_id" = t_id
       AND p."abnormal_flag_logic" IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    params_majority := params_majority + n;

    -- Parameters left without a style: the ones with no live range and no live value (for the NOTICE only).
    SELECT count(*) INTO n FROM "lab_test_result_params" p
     WHERE p."tenant_id" = t_id AND p."deleted_at" IS NULL AND p."abnormal_flag_logic" IS NULL;
    params_blank := params_blank + n;

    -- STEP 2: a ticked "Highlight in Report" on a non-quantitative value becomes HIGHLIGHT.
    UPDATE "lab_report_result_values" v
       SET "flag_option" = 'HIGHLIGHT'
     WHERE v."tenant_id" = t_id
       AND v."highlight_in_report" = true
       AND v."flag_option" <> 'HIGHLIGHT'
       AND EXISTS (
         SELECT 1 FROM "lab_test_result_params" p
          WHERE p."id" = v."result_param_id" AND p."result_type" <> 'QUANTITATIVE'
       );
    GET DIAGNOSTICS n = ROW_COUNT;
    values_converted := values_converted + n;
  END LOOP;

  -- SiteAdmin template parameters (tenant_id NULL): tenant context cleared.
  PERFORM set_config('app.current_tenant_id', '', true);

  -- STEP 1a for templates
  WITH styles AS (
    SELECT r."param_id", r."abnormal_flag_logic"::text AS style
    FROM "lab_test_reference_ranges" r
    WHERE r."tenant_id" IS NULL AND r."deleted_at" IS NULL
    UNION ALL
    SELECT v."param_id", v."abnormal_flag_logic"::text
    FROM "lab_test_reference_values" v
    WHERE v."tenant_id" IS NULL AND v."deleted_at" IS NULL
  ), agreed AS (
    SELECT "param_id", min(style) AS style
    FROM styles
    GROUP BY "param_id"
    HAVING count(DISTINCT style) = 1
  )
  UPDATE "lab_test_result_params" p
     SET "abnormal_flag_logic" = a.style::"AbnormalFlag"
    FROM agreed a
   WHERE p."id" = a."param_id"
     AND p."tenant_id" IS NULL
     AND p."abnormal_flag_logic" IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  params_agreed := params_agreed + n;

  -- STEP 1b for templates
  WITH styles AS (
    SELECT r."param_id", r."abnormal_flag_logic"::text AS style
    FROM "lab_test_reference_ranges" r
    WHERE r."tenant_id" IS NULL AND r."deleted_at" IS NULL
    UNION ALL
    SELECT v."param_id", v."abnormal_flag_logic"::text
    FROM "lab_test_reference_values" v
    WHERE v."tenant_id" IS NULL AND v."deleted_at" IS NULL
  ), counts AS (
    SELECT "param_id", style, count(*) AS c FROM styles GROUP BY "param_id", style
  ), mixed AS (
    SELECT "param_id", max(c) AS top FROM counts
     GROUP BY "param_id" HAVING count(*) > 1
  ), picked AS (
    SELECT m."param_id",
           CASE WHEN (SELECT count(*) FROM counts c2 WHERE c2."param_id" = m."param_id" AND c2.c = m.top) = 1
                THEN (SELECT c2.style FROM counts c2 WHERE c2."param_id" = m."param_id" AND c2.c = m.top)
                ELSE 'BOLD_ONLY' END AS style
      FROM mixed m
  )
  UPDATE "lab_test_result_params" p
     SET "abnormal_flag_logic" = picked.style::"AbnormalFlag"
    FROM picked
   WHERE p."id" = picked."param_id"
     AND p."tenant_id" IS NULL
     AND p."abnormal_flag_logic" IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  params_majority := params_majority + n;

  SELECT count(*) INTO n FROM "lab_test_result_params" p
   WHERE p."tenant_id" IS NULL AND p."deleted_at" IS NULL AND p."abnormal_flag_logic" IS NULL;
  params_blank := params_blank + n;

  RAISE NOTICE 'abnormal flag backfill: % parameter(s) took the style of their ranges/values, % had disagreeing styles and took the most common one (Bold on a tie), % have no ranges/values and are left without a style, % Highlight choice(s) converted.',
    params_agreed, params_majority, params_blank, values_converted;
END
$backfill$;
