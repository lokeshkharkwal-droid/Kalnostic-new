-- Allow partial re-settlement: an order may now back MULTIPLE active settlement
-- links (one per settlement) until its collected amount is fully reserved. Drop the
-- binary double-settlement guard; eligibility is now driven by the remaining
-- unsettled amount, computed in the service layer.
DROP INDEX IF EXISTS "settlement_source_orders_order_active_unique";
