-- Emergency Pricing (Registration Settings → Emergency Pricing).
--
-- 1. Two independent registration-setting toggles (default false = existing
--    behaviour). The effective rule is
--      Override || (ApplyInNonOperatingHours && branch closed right now)
--    and, when it applies, each catalogue lab-test line on an order bills at
--    its `branch_lab_tests.emergency_price` (falls back to `list_price` when
--    that is 0). Panels have no emergency price and keep their list price.
--    Quotations are never emergency-priced.
--    - `emergency_pricing_apply_in_non_operating_hours`: emergency-price orders
--      created outside the branch's operating hours (active schedule shifts,
--      else operational days + opening/closing time). A branch with no hours
--      configured is never "non-operating".
--    - `emergency_pricing_override_emergency_prices`: emergency-price every
--      order, at any time of day.
--
-- 2. `orders.is_emergency_pricing`: server-stamped flag recording whether the
--    order's lab-test lines were priced at emergency prices. Re-resolved on
--    every save until the record becomes an active order, then frozen so later
--    edits keep the same pricing. Existing rows default to false.

ALTER TABLE "registration_settings"
  ADD COLUMN "emergency_pricing_apply_in_non_operating_hours" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emergency_pricing_override_emergency_prices" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "orders"
  ADD COLUMN "is_emergency_pricing" BOOLEAN NOT NULL DEFAULT false;
