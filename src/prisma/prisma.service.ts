import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { tenantContext } from './tenant-context';

/** RLS is opt-in via env so it can be rolled out deliberately (see README). */
function rlsEnabled(): boolean {
  return process.env.RLS_ENABLED === 'true';
}

/**
 * Thin wrapper around the generated Prisma client (CLAUDE.md rule #4 — Prisma
 * only). Inject it via `PrismaModule`; never instantiate `new PrismaClient()`
 * elsewhere.
 *
 * ## Tenant isolation (CLAUDE.md §4.3)
 *
 * Postgres RLS keys every tenant-scoped table on `app.current_tenant_id`. When
 * `RLS_ENABLED=true`, this service installs a Prisma client extension that, for
 * each query, sets that GUC from the per-request `tenantContext`
 * (`AsyncLocalStorage`) inside the same transaction as the query — so the
 * policies in `prisma/rls.sql` resolve. Model access is transparently routed to
 * the extended client via a Proxy, so services keep calling `this.prisma.<model>`.
 *
 * When `RLS_ENABLED` is unset/false (the default), this behaves as the bare
 * Prisma client — no extension, no Proxy, zero behavioural change. Isolation
 * then rests solely on the `where: { tenantId }` clauses (defence in depth).
 *
 * NOTE: enabling RLS requires (1) applying `prisma/rls.sql`, (2) connecting as a
 * non-owner, non-superuser, non-BYPASSRLS role, and (3) ensuring every
 * tenant-scoped multi-statement write uses `withTenant` (array-form
 * `$transaction([...])` under a tenant context is incompatible with the
 * per-op extension — convert those first).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
    if (!rlsEnabled()) {
      // RLS off → plain Prisma client, identical to upstream behaviour.
      return;
    }

    // Prisma's extension callback is typed with `any` (the `query` fn and its
    // result), so the unsafe-any lints are unavoidable here and intentional.
    /* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
    const extended = this.$extends({
      query: {
        // Arrow fn so `this` is the (base) PrismaService instance — no aliasing.
        $allOperations: async ({ args, query }) => {
          const store = tenantContext.getStore();
          const tenantId = store?.tenantId;
          // No tenant context (platform-level/SiteAdmin), or already inside a
          // tenant transaction that set the GUC → run the query unchanged.
          if (!tenantId || store?.rlsTxActive) {
            return query(args);
          }
          // Set the tenant GUC and run the operation in the SAME transaction so
          // the RLS policies see app.current_tenant_id. `set_config(.., true)`
          // is transaction-local, so it auto-resets and is pool-safe.
          const [, result] = await this.$transaction([
            this
              .$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    });
    /* eslint-enable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */

    // Route model access (e.g. `prisma.branch`) to the RLS-aware extended
    // client, while keeping lifecycle hooks, `withTenant`, and `$`-level methods
    // (`$transaction`, `$executeRaw`, `$connect`, …) on the base instance.
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (
          typeof prop === 'string' &&
          !prop.startsWith('$') &&
          prop in extended &&
          !(prop in (target.constructor as { prototype: object }).prototype)
        ) {
          return (extended as Record<string, unknown>)[prop];
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }

  /** Open the database connection on startup. */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Close the database connection on shutdown. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run `work` inside a transaction with the RLS tenant context set, so
   * `current_setting('app.current_tenant_id')` resolves for the policies in
   * `prisma/rls.sql`. Use this for any multi-statement write on tenant-scoped
   * data; the callback receives the transaction client.
   *
   * Marks `rlsTxActive` for the duration so nested model calls don't re-open
   * their own GUC transaction via the extension.
   *
   * @param tenantId the active tenant (from the JWT `tenant_id`)
   * @param work callback receiving the transaction-scoped Prisma client
   */
  async withTenant<T>(
    tenantId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return tenantContext.run(
        { ...tenantContext.getStore(), tenantId, rlsTxActive: true },
        () => work(tx),
      );
    });
  }

  /**
   * Run `work` with the RLS tenant context set (via `AsyncLocalStorage`) but
   * WITHOUT opening a wrapping transaction — so each Prisma model call inside
   * gets its own tenant-GUC transaction through the RLS extension, exactly like
   * a normal business request set up by `TenantContextInterceptor`.
   *
   * Use this for SiteAdmin cross-tenant *reads* that delegate to tenant-scoped
   * services (e.g. listing a tenant's branches), where the base-client queries
   * would otherwise run without the GUC. Unlike `withTenant`, it does **not**
   * set `rlsTxActive`, so the per-op extension stays active.
   *
   * @param tenantId the tenant whose rows the delegated queries should see
   * @param work callback whose model calls should be tenant-scoped
   */
  runWithTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId }, work);
  }
}
