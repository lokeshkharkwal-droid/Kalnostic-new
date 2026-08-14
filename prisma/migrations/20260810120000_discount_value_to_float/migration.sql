-- Widen order item discount_value from integer to float so a fractional
-- percentage (e.g. 12.5%) entered in PERCENT mode round-trips on edit. The
-- computed `discount` amount stays an integer (whole minor units). int ->
-- double precision is a safe implicit widening cast.
ALTER TABLE "order_items" ALTER COLUMN "discount_value" SET DATA TYPE DOUBLE PRECISION;
