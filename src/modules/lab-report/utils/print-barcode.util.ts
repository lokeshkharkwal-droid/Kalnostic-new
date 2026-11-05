import {
  code128DataUri,
  qrCodeDataUri,
} from '../../../common/utils/barcode-image.util';

/**
 * The lab report's barcode/QR print tags, each an image src (data URI) — never
 * the raw value, and never one ID in place of another:
 *  - `order_id_barcode` — the **Order ID** Code 128 barcode, encoding the
 *    order's `Order.orderCode` (e.g. `ORD-00113`) — the Order ID the app shows.
 *    Not `Order.orderIdBarcode`: that order-barcode counter starts at 10001
 *    like the sample counter, so it printed what looked like (and often was) a
 *    Sample ID.
 *  - `order_id_qr_code` — the **Order ID** QR code, encoding the same
 *    `Order.orderCode`.
 *  - `sample_id_barcode` — the **Sample ID** Code 128 barcode, encoding
 *    `OrderSample.barcode` of the report's own sample (e.g. `10023`).
 * The source field — not the value — decides which tag gets which ID.
 * Each is `''` when its value is unset (the tag then renders blank).
 * @param orderCode the order's `orderCode` (its Order ID)
 * @param sampleBarcode the report sample's `barcode` value
 */
export async function buildReportBarcodeTags(
  orderCode: string | null | undefined,
  sampleBarcode: string | null | undefined,
): Promise<{
  order_id_barcode: string;
  order_id_qr_code: string;
  sample_id_barcode: string;
}> {
  return {
    order_id_barcode: code128DataUri(orderCode),
    order_id_qr_code: await qrCodeDataUri(orderCode),
    sample_id_barcode: code128DataUri(sampleBarcode),
  };
}

/**
 * The public patient-order page QR code (data URI) — encodes the public,
 * no-login URL `{frontendUrl}/public/{tenantId}/{branchId}/{orderId}`, so
 * scanning a printed report opens that order's public page. Printed via the
 * `{public_order_qr_code}` tag on `lab_report` / `lab_all_report` templates.
 *
 * Distinct from `{order_id_qr_code}`, which encodes the raw Order ID
 * (`Order.orderCode`) for internal scanning — this one carries a URL.
 *
 * Returns `''` (the tag renders blank) when the frontend base URL or the
 * branch id is unknown, or when the value cannot be encoded.
 * @param frontendUrl the tenant-facing frontend base (`exchange.frontendUrl`)
 * @param tenantId the order's tenant
 * @param branchId the order's branch (public URLs are branch-scoped)
 * @param orderId the order's id
 */
export async function publicOrderQrCode(
  frontendUrl: string | null | undefined,
  tenantId: string,
  branchId: string | null | undefined,
  orderId: string,
): Promise<string> {
  if (!frontendUrl || !branchId) {
    return '';
  }
  const base = frontendUrl.replace(/\/+$/, '');
  return qrCodeDataUri(`${base}/public/${tenantId}/${branchId}/${orderId}`);
}

/**
 * QR code (data URI) for a public **document download** — encodes the no-login
 * FE page URL `{frontendUrl}/public/{tenantId}/{branchId}/{orderId}?download={doc}`
 * (`doc` = `bill` | `report`). Scanning opens the public order page, which then
 * fetches that PDF and saves it to the device (a blob download), with a visible
 * Download button as a fallback.
 *
 * Why the page and not the raw PDF: a QR is usually opened in a phone's in-app
 * webview / mobile browser, which does NOTHING with a forced-`attachment` binary
 * (no download handler → blank screen = "nothing happens"). Routing through the
 * SPA page — a normal HTML page every webview can render — lets a `fetch` + blob
 * + `<a download>` reliably save the file, and degrades to a readable page when
 * a locked-down webview still blocks the save. The page's own actions honour the
 * branch's QR Code Scan Settings (bill printability gate; configured templates),
 * resolved server-side.
 *
 * Same FE *page* route as {@link publicOrderQrCode} (served by the SPA at the
 * origin root — no `/api/v1` prefix), just carrying the `download` query.
 *
 * Returns `''` (the tag renders blank) when the base URL or branch is unknown,
 * or the value cannot be encoded.
 * @param frontendUrl the tenant-facing frontend base (`exchange.frontendUrl`)
 * @param tenantId the order's tenant
 * @param branchId the order's branch (public URLs are branch-scoped)
 * @param orderId the order's id
 * @param doc which document the page should auto-download (`bill` / `report`)
 */
async function publicOrderDownloadQrCode(
  frontendUrl: string | null | undefined,
  tenantId: string,
  branchId: string | null | undefined,
  orderId: string,
  doc: 'bill' | 'report',
): Promise<string> {
  if (!frontendUrl || !branchId) {
    return '';
  }
  const base = frontendUrl.replace(/\/+$/, '');
  return qrCodeDataUri(
    `${base}/public/${tenantId}/${branchId}/${orderId}?download=${doc}`,
  );
}

/**
 * `{qr_download_bill}` — QR that opens the public order page and auto-downloads
 * the patient **bill** PDF to the device. See {@link publicOrderDownloadQrCode}.
 */
export function publicBillDownloadQrCode(
  frontendUrl: string | null | undefined,
  tenantId: string,
  branchId: string | null | undefined,
  orderId: string,
): Promise<string> {
  return publicOrderDownloadQrCode(frontendUrl, tenantId, branchId, orderId, 'bill');
}

/**
 * `{qr_download_all_report}` — QR that opens the public order page and
 * auto-downloads the order's merged **published lab reports** PDF to the device.
 * See {@link publicOrderDownloadQrCode}.
 */
export function publicReportDownloadQrCode(
  frontendUrl: string | null | undefined,
  tenantId: string,
  branchId: string | null | undefined,
  orderId: string,
): Promise<string> {
  return publicOrderDownloadQrCode(frontendUrl, tenantId, branchId, orderId, 'report');
}

/**
 * Pick the sample a lab report prints from its candidate sample links (already
 * scoped to the report's test and ordered oldest first): the first one that
 * carries a barcode, else the first one. A test can span several tubes, and a
 * sample whose barcode was never assigned would leave `{sample_id_barcode}`
 * blank while a sibling tube has one.
 * @param links the report's `OrderSampleTest` rows with their `sample`
 * @returns the chosen sample, or undefined when the report has none
 */
export function pickReportSample<T extends { barcode: string | null }>(
  links: Array<{ sample: T }>,
): T | undefined {
  return (links.find((l) => l.sample.barcode) ?? links[0])?.sample;
}
