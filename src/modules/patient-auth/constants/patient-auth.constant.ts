/**
 * Patient-portal auth constants. The patient auth surface is a third, isolated
 * system (alongside business `'jwt'` and SiteAdmin `'jwt-siteadmin'`) built on
 * the SAME platform-level `person_credentials` / `persons` / `refresh_tokens`
 * tables — no separate credential store (CLAUDE.md §4.2, §5).
 */

/**
 * Fixed temp password staff issue to a patient when enabling portal login
 * (product decision). Stored bcrypt-hashed like every other password — never in
 * plain text — and flagged `isTempPassword` so the first login forces a change.
 * Passes the shared policy (≥8 chars, ≥1 upper, ≥1 digit).
 */
export const PATIENT_TEMP_PASSWORD = 'Password@123';

/** `RefreshToken.tokenType` value for patient-portal sessions. */
export const PATIENT_TOKEN_TYPE = 'patient';

/** `RefreshToken.tokenType` value for business (staff) sessions — the default. */
export const BUSINESS_TOKEN_TYPE = 'business';

/** Discriminator on the patient access-token payload (`type`). */
export const PATIENT_ACCESS_TOKEN_TYPE = 'patient';

/**
 * Discriminator on the short-lived bootstrap token issued by login, exchanged at
 * `select-business` for a tenant-scoped session. Distinct from the access token
 * so a bootstrap token can never reach patient data endpoints.
 */
export const PATIENT_BOOTSTRAP_TOKEN_TYPE = 'patient_bootstrap';

/** Lockout policy — identical to business/SiteAdmin (CLAUDE.md §5.3). */
export const MAX_FAILED_ATTEMPTS = 10;

/** Account lock duration in minutes once the attempt ceiling is hit. */
export const LOCK_DURATION_MINUTES = 15;
