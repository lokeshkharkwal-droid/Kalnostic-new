-- Order-level barcode (generated at order creation), a SEPARATE entity from the
-- sample barcode: its own per-branch counter + format, and its numbers may
-- coincide with sample barcode numbers.
--   order_id_barcode = the barcode VALUE (e.g. "10001")
--   order_id_qr_code = the S3 URL of the rendered Code39 PNG (name kept for the
--                      print-template contract — it is a barcode image, not a QR).
ALTER TABLE "orders" ADD COLUMN "order_id_barcode" TEXT;
ALTER TABLE "orders" ADD COLUMN "order_id_qr_code" TEXT;

-- Per-branch uniqueness of the order barcode VALUE among orders only (NULLs are
-- distinct in Postgres, so unstamped rows do not clash). Does NOT constrain
-- against sample barcodes.
CREATE UNIQUE INDEX "orders_branch_id_order_id_barcode_key" ON "orders" ("branch_id", "order_id_barcode");

-- Dedicated Order Barcode Settings on the per-branch accession settings row,
-- mirroring the Sample Barcode Settings block (own counter + format).
ALTER TABLE "accession_settings" ADD COLUMN "order_barcode_settings_prefix" VARCHAR(24) NOT NULL DEFAULT '';
ALTER TABLE "accession_settings" ADD COLUMN "order_barcode_settings_suffix" VARCHAR(24) NOT NULL DEFAULT '';
ALTER TABLE "accession_settings" ADD COLUMN "order_barcode_settings_separator" "AccessionBarcodeSeparator" NOT NULL DEFAULT 'NONE';
ALTER TABLE "accession_settings" ADD COLUMN "order_barcode_settings_number_length" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "accession_settings" ADD COLUMN "order_barcode_settings_reset_interval" "AccessionBarcodeResetCycle" NOT NULL DEFAULT 'NEVER';
ALTER TABLE "accession_settings" ADD COLUMN "order_barcode_settings_current_number" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "accession_settings" ADD COLUMN "order_barcode_settings_last_reset_at" TIMESTAMP(3);
