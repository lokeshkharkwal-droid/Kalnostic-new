import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { PermissionDeniedException } from '../exceptions/permissions.exceptions';

/**
 * Role keys that hold the full management catalogue and therefore bypass every
 * per-permission check (their baseline grants the whole console). Also prevents
 * self-lockout of admins while RBAC is rolled out per module.
 */
export const ADMIN_BYPASS_ROLES = new Set(['business_admin', 'administrator']);

/** The request context a permission check needs (from the JWT). */
export interface PermissionContext {
  tenantId: string;
  personId: string;
  branchId: string | null;
  profileKey: string | null;
}

/** Build a {@link PermissionContext} from a business JWT payload. */
export function contextFromJwt(user: JwtPayload): PermissionContext {
  return {
    tenantId: user.tenant_id,
    personId: user.person_id,
    branchId: user.active_branch_id,
    profileKey: user.active_profile_key,
  };
}

/**
 * Central business-permission checker — the single source of truth for how a
 * required permission is evaluated. Used both by the route `PermissionGuard` and
 * by controllers that must branch on the request (e.g. `POST /orders` creating an
 * order vs. quote vs. appointment, where a single route decorator can't tell them
 * apart). Resolution reuses {@link UsersService.getEffectivePermissionKeys}
 * (user override ?? branch-role override ?? role baseline).
 *
 * Rollout parity with the guard: admin roles bypass; `RBAC_ENFORCE=false` makes
 * every check log-only (denials logged, request allowed) so baselines can be
 * observed before hard enforcement.
 */
@Injectable()
export class PermissionCheckService {
  private readonly logger = new Logger(PermissionCheckService.name);

  constructor(private readonly usersService: UsersService) {}

  /** Whether the caller effectively holds a single permission key. */
  async has(ctx: PermissionContext, key: string): Promise<boolean> {
    if (this.isAdmin(ctx)) return true;
    if (!ctx.branchId) return false;
    const granted = await this.usersService.getEffectivePermissionKeys(
      ctx.tenantId,
      ctx.personId,
      ctx.branchId,
    );
    return granted.has(key);
  }

  /**
   * Enforce that the caller holds the required permission(s). `mode: 'all'`
   * (default) requires every key; `mode: 'any'` requires at least one. Throws
   * {@link PermissionDeniedException} on failure, unless `RBAC_ENFORCE=false`
   * (log-only). Returns `true` when allowed (used by the guard).
   */
  async enforce(
    ctx: PermissionContext,
    keys: string[],
    mode: 'all' | 'any' = 'all',
  ): Promise<boolean> {
    if (keys.length === 0) return true;
    if (this.isAdmin(ctx)) return true;

    const granted = ctx.branchId
      ? await this.usersService.getEffectivePermissionKeys(
          ctx.tenantId,
          ctx.personId,
          ctx.branchId,
        )
      : new Set<string>();

    const held = keys.filter((k) => granted.has(k));
    const ok = mode === 'any' ? held.length > 0 : held.length === keys.length;
    if (ok) return true;

    const missing = mode === 'any' ? keys : keys.filter((k) => !granted.has(k));
    if (process.env.RBAC_ENFORCE === 'false') {
      this.logger.warn(
        `RBAC log-only: person ${ctx.personId} missing [${missing.join(
          ', ',
        )}] (${mode}) at branch ${ctx.branchId ?? 'none'} — allowing (RBAC_ENFORCE=false)`,
      );
      return true;
    }
    throw new PermissionDeniedException(missing);
  }

  /** Assert a single required key (convenience wrapper over {@link enforce}). */
  async assert(ctx: PermissionContext, key: string): Promise<void> {
    await this.enforce(ctx, [key], 'all');
  }

  /** Assert the caller holds at least one of the keys. */
  async assertAny(ctx: PermissionContext, keys: string[]): Promise<void> {
    await this.enforce(ctx, keys, 'any');
  }

  private isAdmin(ctx: PermissionContext): boolean {
    return !!ctx.profileKey && ADMIN_BYPASS_ROLES.has(ctx.profileKey);
  }
}
