import { SetMetadata } from '@nestjs/common';

/** Metadata key the ProfileGuard reads. */
export const REQUIRE_PROFILE_KEY = 'requiredProfiles';

/**
 * Declares which `active_profile_key` value(s) may call this route. Checked by
 * `ProfileGuard` against the business JWT's active profile (tenant-level
 * profiles like `business_admin` have `active_branch_id = null`).
 *
 * ```ts
 * @RequireProfile('business_admin')
 * ```
 */
export const RequireProfile = (...profileKeys: string[]) =>
  SetMetadata(REQUIRE_PROFILE_KEY, profileKeys);
