import { createCanvas } from '@napi-rs/canvas';
import JsBarcode from 'jsbarcode';
import { toDataURL } from 'qrcode';

// Deliberately NOT re-exported from `common/utils/index.ts`: it loads the
// native `@napi-rs/canvas` binding, which every barrel importer would then pay
// for. Import it by path where a barcode/QR image is actually rendered.

/**
 * Render a Code 128 barcode PNG for the given value. Uses a fixed generation
 * configuration (bar width, height, human-readable value shown) so the same
 * value always produces a consistently scannable image. `jsbarcode` picks the
 * optimal Code 128 subset (128A/B/C) for the value automatically.
 *
 * The single barcode generator for the app — `BarcodeService` uploads this
 * image for sample/order barcodes, and print contexts inline it via
 * {@link code128DataUri}.
 * @param value the barcode value/id to encode
 * @returns the PNG image bytes
 * @throws Error when `jsbarcode` rejects the value (e.g. non-ASCII input)
 */
export function renderCode128Png(value: string): Buffer {
  const canvas = createCanvas(300, 120);
  JsBarcode(canvas, value, {
    format: 'CODE128',
    displayValue: true,
    width: 2,
    height: 60,
    margin: 10,
    fontSize: 16,
  });
  return canvas.toBuffer('image/png');
}

/**
 * A Code 128 barcode of `value` as a `data:image/png;base64,…` URI, for print
 * templates (`<img src="…">` / `{{image:…}}`). Rendered from the value itself
 * rather than a stored upload URL, so the image always encodes exactly the
 * current DB value and needs no network fetch when Puppeteer prints it.
 * @param value the barcode value/id to encode
 * @returns the data URI, or `''` when `value` is empty or cannot be encoded
 */
export function code128DataUri(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  try {
    return `data:image/png;base64,${renderCode128Png(value).toString('base64')}`;
  } catch {
    return '';
  }
}

/**
 * A QR code of `value` as a `data:image/png;base64,…` URI, for print templates
 * (`<img src="…">` / `{{image:…}}`). Like {@link code128DataUri} it is rendered
 * from the value itself, so it always encodes the current DB value and needs no
 * network fetch when Puppeteer prints it. Error correction `M` (~15%) keeps a
 * short ID scannable after printing; the 2-module white margin is built into
 * the image so it still scans when placed flush against a table border.
 * @param value the text to encode
 * @returns the data URI, or `''` when `value` is empty or cannot be encoded
 */
export async function qrCodeDataUri(
  value: string | null | undefined,
): Promise<string> {
  if (!value) {
    return '';
  }
  try {
    return await toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 160,
    });
  } catch {
    return '';
  }
}
