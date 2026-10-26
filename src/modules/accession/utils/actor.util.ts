import type { JwtPayload } from '../../auth/types/jwt-payload.type';

/** The acting user's role as the Audit log records it (key + human-readable label). */
export interface AuditActor {
  roleKey: string | null;
  roleLabel: string | null;
}

/**
 * The role of the person making a request, read from the JWT the same way the
 * `AuditInterceptor` does (the label comes from the profile that is currently active).
 */
export function auditActorOf(
  user: Pick<JwtPayload, 'active_profile_key' | 'profiles'> | undefined,
): AuditActor {
  const roleKey = user?.active_profile_key ?? null;
  const roleLabel =
    user?.profiles?.find((p) => p.profile_key === roleKey)?.profile_label ??
    null;
  return { roleKey, roleLabel };
}
