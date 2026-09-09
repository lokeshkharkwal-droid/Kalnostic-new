import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request tenant context, propagated via `AsyncLocalStorage` so the Prisma
 * RLS extension (see `PrismaService`) can read the active tenant without
 * threading it through every service call.
 *
 * Populated by `TenantContextInterceptor` from the business JWT's `tenant_id`.
 * Absent for platform-level/SiteAdmin/unauthenticated requests — the extension
 * then runs queries without setting the tenant GUC (platform tables aren't
 * under RLS).
 */
export interface TenantContextStore {
  /** Active tenant id from the JWT, or undefined for platform-level requests. */
  tenantId?: string;
  /**
   * True while inside a transaction that has already set the tenant GUC
   * (e.g. `PrismaService.withTenant`), so the extension passes through instead
   * of opening another transaction.
   */
  rlsTxActive?: boolean;
  /**
   * The referral panel the current request is scoped to — set by `B2bScopeGuard`
   * only for B2B Referring Panel sessions. Read by order/invoice/payment/report
   * services to force per-panel isolation.
   */
  referralPanelId?: string;
}

/** The shared async-context store for the current request's tenant. */
export const tenantContext = new AsyncLocalStorage<TenantContextStore>();

/** The active tenant id for the current async context, if any. */
export function getTenantId(): string | undefined {
  return tenantContext.getStore()?.tenantId;
}

/** The referral panel id for the current async context, if any (B2B sessions). */
export function getReferralPanelId(): string | undefined {
  return tenantContext.getStore()?.referralPanelId;
}
