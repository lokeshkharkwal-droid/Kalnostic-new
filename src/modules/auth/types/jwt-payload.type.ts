import { Request } from 'express';
import { BranchType } from '@prisma/client';

/**
 * Business-user JWT access-token payload (CLAUDE.md §5.1 — preserve exactly).
 *
 * All branch+profile assignments are embedded so the frontend switcher renders
 * without an extra API call. Access token lifetime 15m; refresh 30d.
 */
export interface JwtPayload {
  /** Person UUID — the identity of the logged-in user. */
  person_id: string;
  /** Active tenant context. */
  tenant_id: string;
  /** Active branch the user is working at (null for tenant-level profiles). */
  active_branch_id: string | null;
  /** Type of the active branch — drives which module features are available. */
  active_branch_type: BranchType | null;
  /** Active profile key — determines permissions for this session. */
  active_profile_key: string | null;
  /** True when viewing the patient-portal context (vs. staff context). */
  is_patient_context: boolean;
  /** Every branch+profile assignment for this person (for the switcher UI). */
  profiles: JwtProfileEntry[];
  /** Whether this person has a patient record anywhere on the platform. */
  is_patient: boolean;
  /** Platform MRN — null if never registered as a patient. */
  platform_mrn: string | null;
  /** Standard JWT — issued at (Unix seconds). */
  iat?: number;
  /** Standard JWT — expiry (Unix seconds). */
  exp?: number;
}

/**
 * One entry per branch+profile combination embedded in the JWT.
 * `branch_*` fields are null for tenant-level profiles (e.g. business_admin).
 */
export interface JwtProfileEntry {
  branch_id: string | null;
  branch_name: string | null;
  branch_type: BranchType | null;
  profile_key: string;
  profile_label: string;
  is_default: boolean;
}

/** The Express request after business authentication (`@CurrentUser()` reads `user`). */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
