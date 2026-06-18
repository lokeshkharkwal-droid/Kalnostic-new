/**
 * Shared validation regexes for the User Management v2.0 contract. Centralised
 * so the DTOs, services, and any future callers validate identically.
 */
export const VALIDATION_PATTERNS = {
  /** Letters and spaces only (names). */
  ALPHA_SPACES: /^[A-Za-z ]+$/,
  /** Lowercase alphanumeric plus dot and underscore (username). */
  USERNAME: /^[a-z0-9._]+$/,
  /** Indian 10-digit mobile number (starts 6-9). */
  INDIAN_MOBILE: /^[6-9]\d{9}$/,
  /** Exactly 12 digits (Aadhaar, before formatting/encryption). */
  AADHAAR: /^\d{12}$/,
  /** Indian PAN: 5 letters, 4 digits, 1 letter (uppercase). */
  PAN: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  /**
   * Strong password: ≥8 chars with at least one lowercase, one uppercase, one
   * digit, and one special character (v2.0 — stricter than CLAUDE.md §5.3,
   * applied only to user-set passwords).
   */
  STRONG_PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/,
} as const;

/** Allowed MIME types for profile-photo uploads (JPG/JPEG/PNG). */
export const ALLOWED_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
] as const;
