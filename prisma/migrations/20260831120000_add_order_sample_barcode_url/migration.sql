-- Store the S3 URL of a sample's rendered Code 39 barcode image alongside the
-- barcode value. `barcode` = the value/ID (system-sequential from 10001, shared
-- across a grouping bucket); `order_id_barcode` = the generated image asset URL.
ALTER TABLE "order_samples" ADD COLUMN "order_id_barcode" TEXT;

-- Barcodes now start at 10001 (5 digits), so the default number-length is 5.
ALTER TABLE "accession_settings"
  ALTER COLUMN "sample_barcode_settings_number_length" SET DEFAULT 5;
