-- Rewrite four stale placeholder tags in saved messaging templates to their
-- GLOBAL notification-tag equivalents.
--
-- WHY. Notification tags are one global catalogue
-- (src/modules/template/constants/notification-tags.ts), resolved for every
-- send. The platform-default templates seeded before that catalogue existed
-- (and every business copy cloned from them) still use four tags that NOTHING
-- fills, so those messages go out with the literal text, e.g.
--   "your report for order {order_id} is ready: {report_link}".
-- prisma/seed.ts already writes the canonical tags, but it skips templates that
-- already exist, so existing databases need this one-off rewrite.
--
-- WHAT. In `templates.template` (the body) and `templates.display_title` (the
-- Email subject), for every non-deleted row:
--   {order_id}          -> {order_number}
--   {report_link}       -> {publish_report_url}
--   {branch_name}       -> {user_name}
--   {appointment_date}  -> {date} {time}   (SMS / Email / in-app)
--   {appointment_date}  -> {date}          (WhatsApp: one placeholder stays one,
--                                           so the approved template's positional
--                                           {{n}} parameter count never changes)
-- Nothing else in the text is touched. Idempotent: a row is only updated while
-- it still contains one of the four tokens, so a re-run is a no-op.
--
-- ROW-LEVEL SECURITY. `templates` has FORCE ROW LEVEL SECURITY: tenant rows are
-- visible/writable only with `app.current_tenant_id` set to their tenant, and
-- platform rows (tenant_id NULL) are writable only with NO tenant set. A
-- migration role that is not superuser / BYPASSRLS would otherwise update zero
-- rows. So the rewrite runs once per tenant with the GUC set (as
-- PrismaService.withTenant does), then once with it cleared for the platform
-- rows. The setting is transaction-local and cleared at the end.
--
-- LOCKING: no ALTER TABLE; plain row UPDATEs only.

DO $$
DECLARE
  t_id text;
BEGIN
  -- Business copies (tenant-scoped rows), one tenant at a time.
  FOR t_id IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.current_tenant_id', t_id, true);

    UPDATE "templates" AS t
    SET "template" = CASE
          WHEN t."preference"::text = 'WHATSAPP' THEN
            replace(replace(replace(replace(t."template",
              '{order_id}', '{order_number}'),
              '{report_link}', '{publish_report_url}'),
              '{branch_name}', '{user_name}'),
              '{appointment_date}', '{date}')
          ELSE
            replace(replace(replace(replace(t."template",
              '{order_id}', '{order_number}'),
              '{report_link}', '{publish_report_url}'),
              '{branch_name}', '{user_name}'),
              '{appointment_date}', '{date} {time}')
        END,
        "display_title" = replace(replace(replace(replace(t."display_title",
              '{order_id}', '{order_number}'),
              '{report_link}', '{publish_report_url}'),
              '{branch_name}', '{user_name}'),
              '{appointment_date}', '{date} {time}'),
        "updated_at" = now()
    WHERE t."tenant_id" = t_id
      AND t."deleted_at" IS NULL
      AND (coalesce(t."template", '') || ' ' || coalesce(t."display_title", ''))
          ~ '\{(order_id|report_link|branch_name|appointment_date)\}';
  END LOOP;

  -- Platform defaults (tenant_id NULL): writable only with no tenant set.
  PERFORM set_config('app.current_tenant_id', '', true);

  UPDATE "templates" AS t
  SET "template" = CASE
        WHEN t."preference"::text = 'WHATSAPP' THEN
          replace(replace(replace(replace(t."template",
            '{order_id}', '{order_number}'),
            '{report_link}', '{publish_report_url}'),
            '{branch_name}', '{user_name}'),
            '{appointment_date}', '{date}')
        ELSE
          replace(replace(replace(replace(t."template",
            '{order_id}', '{order_number}'),
            '{report_link}', '{publish_report_url}'),
            '{branch_name}', '{user_name}'),
            '{appointment_date}', '{date} {time}')
      END,
      "display_title" = replace(replace(replace(replace(t."display_title",
            '{order_id}', '{order_number}'),
            '{report_link}', '{publish_report_url}'),
            '{branch_name}', '{user_name}'),
            '{appointment_date}', '{date} {time}'),
      "updated_at" = now()
  WHERE t."tenant_id" IS NULL
    AND t."deleted_at" IS NULL
    AND (coalesce(t."template", '') || ' ' || coalesce(t."display_title", ''))
        ~ '\{(order_id|report_link|branch_name|appointment_date)\}';
END
$$;
