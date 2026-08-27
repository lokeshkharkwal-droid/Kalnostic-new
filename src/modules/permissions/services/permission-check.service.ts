import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { PermissionDeniedException } from '../exceptions/permissions.exceptions';
import { PrismaService } from '../../../prisma/prisma.service';
import { tenantContext } from '../../../prisma/tenant-context';

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

  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  /** Whether the caller effectively holds a single permission key. */
  async has(ctx: PermissionContext, key: string): Promise<boolean> {
    if (this.isAdmin(ctx)) return true;
    if (!ctx.branchId) return false;
    const granted = await this.getGrantedKeys(ctx);
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
      ? await this.getGrantedKeys(ctx)
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

  /**
   * Resolve the caller's effective permission keys, ensuring the RLS tenant GUC
   * is set for the lookup. `PermissionGuard` runs this from `canActivate()` — a
   * Guard, which Nest executes *before* interceptors — so when there's no
   * pre-existing async-local tenant context, `TenantContextInterceptor` hasn't
   * run yet. Without this, `RLS_ENABLED=true` deployments silently filter out
   * every row via `prisma/rls.sql`'s tenant-isolation policies, and a real
   * staff member gets a false `StaffMembershipNotFoundException`. Reuses an
   * already-active context untouched (e.g. a controller calling `has()`/
   * `enforce()` directly after the interceptor has run, or from inside
   * `PrismaService.withTenant`).
   */
  private getGrantedKeys(ctx: PermissionContext): Promise<Set<string>> {
    const resolve = () =>
      this.usersService.getEffectivePermissionKeys(
        ctx.tenantId,
        ctx.personId,
        ctx.branchId as string,
      );
    return tenantContext.getStore()?.tenantId
      ? resolve()
      : this.prisma.runWithTenant(ctx.tenantId, resolve);
  }
}
