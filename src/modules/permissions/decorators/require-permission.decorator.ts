import { SetMetadata } from '@nestjs/common';

/** Metadata key the business PermissionGuard reads. */
export const BUSINESS_PERMISSIONS_KEY = 'businessPermissions';

/**
 * Declares the business permission keys required for a route. The
 * {@link PermissionGuard} AND-checks all of them against the caller's effective
 * permissions (user override ?? branch-role override ?? role baseline) at the
 * active branch. Apply with `@UseGuards(PermissionGuard)` on the controller/route
 * (the guard is opt-in — a route with no `@RequirePermission` is never gated).
 *
 * ```ts
 * @UseGuards(PermissionGuard)
 * @RequirePermission('registration:settings')
 * ```
 */
export const RequirePermission = (...keys: string[]) =>
  SetMetadata(BUSINESS_PERMISSIONS_KEY, keys);

/** Metadata key the guard reads for OR-semantics ("any of these") checks. */
export const BUSINESS_ANY_PERMISSIONS_KEY = 'businessAnyPermissions';

/**
 * Declares that the caller needs AT LEAST ONE of the given permission keys
 * (OR-semantics) — for endpoints shared across variants where holding the
 * action for any variant suffices (e.g. an accession transfer endpoint shared
 * across internal/external/outsource referral kinds).
 *
 * ```ts
 * @UseGuards(PermissionGuard)
 * @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.PICK_UP)
 * ```
 */
export const RequireAnyPermission = (...keys: string[]) =>
  SetMetadata(BUSINESS_ANY_PERMISSIONS_KEY, keys);
