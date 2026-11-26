-- Best-effort backfill of communication_logs.order_id for messages sent before
-- the column existed (added by 20261126120000_add_communication_log_order_id).
--
-- Those rows don't store their order, but most of them carry its CODE:
--   1. `payload.variables.order_code` / `order_number` — automatic notifications
--      (their resolved global tags) and the bill / quote / appointment / TRF
--      shares (their kind variables);
--   2. else the PDF attachment name `lab-report-<code>.pdf`, `bill-<code>.pdf`,
--      `quotation-<code>.pdf` or `trf-<code>.pdf` (the code falls back to the
--      order id when an order has no code) — this covers the lab-report share,
--      whose variables are empty.
-- A row is linked only when EXACTLY ONE order of the same tenant, created no
-- later than the message, has that code (or id). Soft-deleted orders count,
-- because an order code can be reused after delete — an ambiguous match is left
-- NULL rather than guessed. Only Email / SMS / WhatsApp rows are considered, and
-- an already-linked row is never overwritten.
--
-- Not recoverable (stay NULL, so they don't show in Past Notifications):
-- lab-report shares sent by SMS and automatic emails sent with the free-text
-- fallback (no code stored), manual compose, and rows whose order no longer
-- exists.
--
-- ROW-LEVEL SECURITY: communication_logs and orders have FORCE ROW LEVEL
-- SECURITY, so a migration role that is not a superuser / BYPASSRLS would
-- otherwise see ZERO rows and "succeed" without linking anything. The backfill
-- therefore runs once per tenant with `app.current_tenant_id` set exactly as the
-- app does (PrismaService.withTenant), every statement also filters on the
-- tenant, and the setting is cleared at the end.
--
-- LOCKING: this file deliberately contains NO ALTER TABLE (Prisma runs a
-- migration file as one transaction; see 20261009120000 for the reasoning).

DO $backfill$
DECLARE
  t_id text;
  n bigint;
  linked bigint := 0;
BEGIN
  FOR t_id IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.current_tenant_id', t_id, true);

    WITH candidates AS (
      SELECT cl."id"         AS log_id,
             cl."created_at" AS sent_at,
             COALESCE(
               NULLIF(btrim(cl."payload" -> 'variables' ->> 'order_code'), ''),
               NULLIF(btrim(cl."payload" -> 'variables' ->> 'order_number'), ''),
               (regexp_match(
                  cl."payload" -> 'attachments' -> 0 ->> 'name',
                  '^(lab-report|bill|quotation|trf)-(.+)\.pdf$'
               ))[2]
             ) AS code
        FROM "communication_logs" cl
       WHERE cl."tenant_id" = t_id
         AND cl."order_id" IS NULL
         AND cl."payload" IS NOT NULL
         AND cl."channel" IN ('EMAIL', 'SMS', 'WHATSAPP')
    ),
    matches AS (
      SELECT c.log_id, o."id" AS order_id
        FROM candidates c
        JOIN "orders" o
          ON o."tenant_id" = t_id
         AND (o."order_code" = c.code OR o."id" = c.code)
         AND o."created_at" <= c.sent_at
       WHERE c.code IS NOT NULL
    ),
    unique_matches AS (
      SELECT log_id, MIN(order_id) AS order_id
        FROM matches
       GROUP BY log_id
      HAVING COUNT(DISTINCT order_id) = 1
    )
    UPDATE "communication_logs" cl
       SET "order_id" = um.order_id
      FROM unique_matches um
     WHERE cl."id" = um.log_id
       AND cl."tenant_id" = t_id
       AND cl."order_id" IS NULL;

    GET DIAGNOSTICS n = ROW_COUNT;
    linked := linked + n;
  END LOOP;

  PERFORM set_config('app.current_tenant_id', '', true);
  RAISE NOTICE 'communication_logs.order_id backfill: % row(s) linked to their order', linked;
END
$backfill$;
