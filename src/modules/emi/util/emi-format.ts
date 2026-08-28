import { Gender } from '@prisma/client';

/**
 * Convert a `Date` to Unix epoch **seconds** (legacy EMI wire format uses seconds
 * for `order_date` / `birth_date`, via PHP `strtotime`).
 * @param date the date (or null/undefined)
 * @returns epoch seconds, or 0 when no date (mirrors the legacy `strtotime` of an
 *   empty value)
 */
export function toEpochSeconds(date: Date | null | undefined): number {
  if (!date) {
    return 0;
  }
  return Math.floor(date.getTime() / 1000);
}

/**
 * The single-letter gender the legacy API emits (`substr($gender, 0, 1)`), e.g.
 * `MALE → "M"`, `FEMALE → "F"`.
 * @param gender the patient gender enum (or null)
 * @returns the first letter, or "" when unknown
 */
export function genderInitial(gender: Gender | null | undefined): string {
  if (!gender) {
    return '';
  }
  return gender.charAt(0);
}

/**
 * Parse the machine-supplied `result_date` — an epoch value sent as a string that
 * may be in **milliseconds** (13 digits, the common case) or **seconds**.
 * @param raw the raw `result_date` value from the payload
 * @returns a `Date`, or `null` when absent/unparseable (caller falls back to now)
 */
export function parseResultDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  // >= 1e12 ≈ a millisecond timestamp; otherwise treat as seconds.
  const ms = n >= 1_000_000_000_000 ? n : n * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Case/space-insensitive key for matching a machine-supplied identifier
 * (`universal_test_id` / `test_name`) against our `testCode` / `parameterName`.
 * @param value the raw identifier
 * @returns a normalised comparison key ("" when empty)
 */
export function matchKey(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

/** MIME → file extension for the image types analyzers send as histograms. */
const MIME_EXT: Record<string, string> = {
  'image/bmp': '.bmp',
  'image/x-ms-bmp': '.bmp',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/** A decoded data-URI: the raw bytes plus its MIME type and file extension. */
export interface DecodedDataUri {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

/**
 * Decode a base64 `data:` URI (e.g. `data:image/bmp;base64,Qk1…`) into its bytes,
 * MIME type and file extension — used to persist analyzer histogram images.
 * @param data the data-URI string
 * @returns the decoded buffer/contentType/ext, or `null` if not a base64 data-URI
 */
export function parseDataUri(data: unknown): DecodedDataUri | null {
  if (typeof data !== 'string') {
    return null;
  }
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(data.trim());
  if (!match) {
    return null;
  }
  const contentType = (match[1] ?? '').toLowerCase();
  const b64 = match[2] ?? '';
  if (!contentType || !b64) {
    return null;
  }
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) {
    return null;
  }
  return { buffer, contentType, ext: MIME_EXT[contentType] ?? '.bin' };
}
