-- Order edit history for the radiology/worklist order Timeline.
-- Append-only JSON array of `{ iteration, at, by }`, written inside each order
-- update() transaction. Nullable; existing orders backfill lazily (null = never
-- edited since this shipped). Covered by the existing `orders` RLS policy.
ALTER TABLE "orders" ADD COLUMN "update_history" JSONB;
