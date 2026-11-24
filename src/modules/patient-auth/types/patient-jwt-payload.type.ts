import { Request } from 'express';

/**
 * Patient-portal access-token payload. Completely separate from the business
 * `JwtPayload` and the SiteAdmin payload; the `type: 'patient'` discriminator
 * (validated by the `'jwt-patient'` strategy) stops a patient token being used
 * on business/SiteAdmin routes and vice-versa (CLAUDE.md §5 pattern).
 *
 * Scoped to one tenant at a time — "login then pick business" resolves the
 * tenant at `select-business`, so this token always carries a concrete
 * `tenant_id` + `patient_id`. Issued by `POST /patient-portal/auth/select-business`.
 */
export interface PatientJwtPayload {
  /** Discriminator — must be `'patient'`. */
  type: 'patient';
  /** Platform `Person` UUID backing this patient. */
  person_id: string;
  /** The tenant-scoped `Patient` row this session acts as. */
  patient_id: string;
  /** Active tenant (the business whose portal the patient entered). */
  tenant_id: string;
  /** The patient's registration branch, if any (patients are tenant-level). */
  active_branch_id: string | null;
  /** Globally-unique platform MRN (display/support). */
  platform_mrn: string | null;
  /** Always true — marks the patient-portal context (vs. staff). */
  is_patient_context: true;
  /**
   * True while the patient is still on the staff-issued temp password. The
   * `PatientJwtGuard` restricts such sessions to routes marked
   * `@AllowTempPassword()` (i.e. change-password) until they set their own.
   */
  must_change_password: boolean;
  /** Standard JWT — issued at (Unix seconds). */
  iat?: number;
  /** Standard JWT — expiry (Unix seconds). */
  exp?: number;
}

/**
 * Short-lived bootstrap token returned by `login`, before a tenant is chosen.
 * Carries only the authenticated identity; it is exchanged (together with the
 * chosen tenant) at `select-business` for a real access + refresh pair. It is
 * NOT accepted by the `'jwt-patient'` strategy, so it can never reach patient
 * data endpoints.
 */
export interface PatientBootstrapPayload {
  /** Discriminator — must be `'patient_bootstrap'`. */
  type: 'patient_bootstrap';
  /** Authenticated platform `Person` UUID. */
  person_id: string;
  /** Globally-unique platform MRN (display). */
  platform_mrn: string | null;
  /** Whether the authenticated credential is still a temp password. */
  must_change_password: boolean;
  iat?: number;
  exp?: number;
}

/** Express request after patient auth — `PatientJwtGuard` sets `req.user`. */
export interface AuthenticatedPatientRequest extends Request {
  user: PatientJwtPayload;
}
