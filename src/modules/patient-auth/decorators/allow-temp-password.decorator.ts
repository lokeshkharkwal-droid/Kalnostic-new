import { SetMetadata } from '@nestjs/common';

/** Reflector key read by `PatientJwtGuard` to allow temp-password sessions. */
export const ALLOW_TEMP_PASSWORD_KEY = 'allowTempPassword';

/**
 * Marks a patient route as reachable while the session is still on a staff-issued
 * temp password (`must_change_password`). Without it, `PatientJwtGuard`
 * default-denies temp-password sessions so they can only hit change-password —
 * the mitigation for the shared fixed temp password.
 */
export const AllowTempPassword = () =>
  SetMetadata(ALLOW_TEMP_PASSWORD_KEY, true);
