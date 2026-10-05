import { code128DataUri } from '../../../common/utils/barcode-image.util';

/**
 * The lab report's two barcode print tags, each a Code 128 image src (data URI)
 * — never the raw value, and never one ID in place of the other:
 *  - `order_id_barcode` — the **Order ID** barcode, encoding
 *    `Order.orderIdBarcode` (the order-barcode counter value, e.g. `10020`).
 *  - `order_id_qr_code` — the **Sample ID** barcode, encoding
 *    `OrderSample.barcode` of the report's own sample (e.g. `10023`). The tag
 *    name is historical: it renders a barcode, not a QR code.
 * Order and sample barcodes come from independent counters and may share a
 * number, so the source field — not the value — decides which tag gets it.
 * Each is `''` when its value is unset (the tag then renders blank).
 * @param orderBarcode the order's `orderIdBarcode` value
 * @param sampleBarcode the report sample's `barcode` value
 */
export function buildReportBarcodeTags(
  orderBarcode: string | null | undefined,
  sampleBarcode: string | null | undefined,
): { order_id_barcode: string; order_id_qr_code: string } {
  return {
    order_id_barcode: code128DataUri(orderBarcode),
    order_id_qr_code: code128DataUri(sampleBarcode),
  };
}

/**
 * Pick the sample a lab report prints from its candidate sample links (already
 * scoped to the report's test and ordered oldest first): the first one that
 * carries a barcode, else the first one. A test can span several tubes, and a
 * sample whose barcode was never assigned would leave `{order_id_qr_code}`
 * blank while a sibling tube has one.
 * @param links the report's `OrderSampleTest` rows with their `sample`
 * @returns the chosen sample, or undefined when the report has none
 */
export function pickReportSample<T extends { barcode: string | null }>(
  links: Array<{ sample: T }>,
): T | undefined {
  return (links.find((l) => l.sample.barcode) ?? links[0])?.sample;
}
