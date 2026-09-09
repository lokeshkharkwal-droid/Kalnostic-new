/**
 * Phone-number helpers. Used as the canonical de-duplication key for the
 * platform-level `Person.phone` (globally unique) — the shared cross-tenant
 * patient identity. The raw, as-entered value is still stored on
 * `Patient.mobile`; only the `Person.phone` key is normalized so the same human
 * dials to the same identity regardless of formatting.
 */

/** An Indian mobile number: 10 digits, first digit 6-9 (mirrors the FE rule). */
const VALID_MOBILE = /^[6-9]\d{9}$/;

/**
 * Normalize a mobile number to its canonical 10-digit form: strip every
 * non-digit and, when a country code is present, keep the trailing 10 digits
 * (e.g. `+91 98765 43210` → `9876543210`). Returns the digit string as-is when
 * it isn't a clean 10-digit number so callers can decide via {@link isValidPhone}.
 * @param raw the as-entered mobile string (may be null/undefined)
 * @returns the normalized digit string (empty string for null/undefined/no digits)
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) {
    return '';
  }
  const digits = raw.replace(/\D/g, '');
  // Drop a leading country code (e.g. 91) when it leaves exactly 10 digits.
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

/**
 * Whether a normalized value is a usable global identity key (a valid 10-digit
 * mobile). Only such numbers are `Person`-backed; anything else stays a plain
 * per-tenant `Patient.mobile` with no shared identity.
 * @param normalized a value already passed through {@link normalizePhone}
 */
export function isValidPhone(normalized: string): boolean {
  return VALID_MOBILE.test(normalized);
}
