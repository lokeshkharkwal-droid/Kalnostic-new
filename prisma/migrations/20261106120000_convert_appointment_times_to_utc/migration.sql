-- Convert appointment / collection SCHEDULE datetimes from the legacy
-- "naive business-local wall clock tagged UTC" representation to TRUE UTC,
-- per each tenant's configured IANA timezone (Tenant.settings.timezone).
--
-- Background: these columns were historically stored as the picked wall clock
-- tagged `Z` (e.g. a 14:30 booking was stored as 14:30Z, not the real instant).
-- The app now stores/compares them as true UTC and converts to the tenant zone
-- for display + slot matching (same convention as every other timestamp).
--
-- The conversion reinterprets the stored wall clock as business-local time and
-- re-expresses it in UTC:
--     (col AT TIME ZONE 'UTC')  -> the naive wall clock (timestamp w/o tz)
--     (... ) AT TIME ZONE tz    -> that wall clock interpreted in `tz`, as UTC
-- e.g. 14:30Z with tz 'Asia/Kolkata' -> 09:00Z. UTC tenants are a no-op.
--
-- Postgres is DST-aware via its tz database. Slots are NOT touched: they stay
-- authored in business-local HH:mm + a business-local slot_date. This migration
-- is applied exactly once (Prisma migration history), so it is not re-runnable.
--
-- NOTE: tenant zones are constrained to SUPPORTED_TIMEZONES on write, so
-- `settings->>'timezone'` is always a valid IANA name here; a missing/empty
-- value falls back to the platform default 'Asia/Kolkata' (mirrors getLocale).

WITH tenant_tz AS (
  SELECT
    id,
    COALESCE(NULLIF("settings" ->> 'timezone', ''), 'Asia/Kolkata') AS tz
  FROM "tenants"
)
UPDATE "orders" o
SET "appointment_at" =
  ("appointment_at" AT TIME ZONE 'UTC') AT TIME ZONE t.tz
FROM tenant_tz t
WHERE o."tenant_id" = t.id
  AND o."appointment_at" IS NOT NULL;

WITH tenant_tz AS (
  SELECT id, COALESCE(NULLIF("settings" ->> 'timezone', ''), 'Asia/Kolkata') AS tz
  FROM "tenants"
)
UPDATE "order_diagnostics" d
SET
  "collection_at" = CASE
    WHEN d."collection_at" IS NOT NULL
    THEN ("collection_at" AT TIME ZONE 'UTC') AT TIME ZONE t.tz
    ELSE d."collection_at" END,
  "appointment_at" = CASE
    WHEN d."appointment_at" IS NOT NULL
    THEN ("appointment_at" AT TIME ZONE 'UTC') AT TIME ZONE t.tz
    ELSE d."appointment_at" END
FROM tenant_tz t
WHERE d."tenant_id" = t.id
  AND (d."collection_at" IS NOT NULL OR d."appointment_at" IS NOT NULL);

WITH tenant_tz AS (
  SELECT id, COALESCE(NULLIF("settings" ->> 'timezone', ''), 'Asia/Kolkata') AS tz
  FROM "tenants"
)
UPDATE "order_opd" op
SET
  "consultation_at" = CASE
    WHEN op."consultation_at" IS NOT NULL
    THEN ("consultation_at" AT TIME ZONE 'UTC') AT TIME ZONE t.tz
    ELSE op."consultation_at" END,
  "appointment_at" = CASE
    WHEN op."appointment_at" IS NOT NULL
    THEN ("appointment_at" AT TIME ZONE 'UTC') AT TIME ZONE t.tz
    ELSE op."appointment_at" END
FROM tenant_tz t
WHERE op."tenant_id" = t.id
  AND (op."consultation_at" IS NOT NULL OR op."appointment_at" IS NOT NULL);

WITH tenant_tz AS (
  SELECT id, COALESCE(NULLIF("settings" ->> 'timezone', ''), 'Asia/Kolkata') AS tz
  FROM "tenants"
)
UPDATE "order_radiology" r
SET "appointment_at" =
  ("appointment_at" AT TIME ZONE 'UTC') AT TIME ZONE t.tz
FROM tenant_tz t
WHERE r."tenant_id" = t.id
  AND r."appointment_at" IS NOT NULL;

WITH tenant_tz AS (
  SELECT id, COALESCE(NULLIF("settings" ->> 'timezone', ''), 'Asia/Kolkata') AS tz
  FROM "tenants"
)
UPDATE "home_visit_collections" h
SET "scheduled_collection_at" =
  ("scheduled_collection_at" AT TIME ZONE 'UTC') AT TIME ZONE t.tz
FROM tenant_tz t
WHERE h."tenant_id" = t.id
  AND h."scheduled_collection_at" IS NOT NULL;
