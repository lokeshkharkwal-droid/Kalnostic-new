import { code128DataUri } from '../../../common/utils/barcode-image.util';

/**
 * The lab report's two barcode print tags, each a Code 128 image src (data URI)
 * — never the raw value, and never one ID in place of the other:
 *  - `order_id_barcode` — the **Order ID** barcode, encoding the order's
 *    `Order.orderCode` (e.g. `ORD-00113`) — the Order ID the app shows. Not
 *    `Order.orderIdBarcode`: that order-barcode counter starts at 10001 like
 *    the sample counter, so it printed what looked like (and often was) a
 *    Sample ID.
 *  - `order_id_qr_code` — the **Sample ID** barcode, encoding
 *    `OrderSample.barcode` of the report's own sample (e.g. `10023`). The tag
 *    name is historical: it renders a barcode, not a QR code.
 * The source field — not the value — decides which tag gets which ID.
 * Each is `''` when its value is unset (the tag then renders blank).
 * @param orderCode the order's `orderCode` (its Order ID)
 * @param sampleBarcode the report sample's `barcode` value
 */
export function buildReportBarcodeTags(
  orderCode: string | null | undefined,
  sampleBarcode: string | null | undefined,
): { order_id_barcode: string; order_id_qr_code: string } {
  return {
    order_id_barcode: code128DataUri(orderCode),
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
