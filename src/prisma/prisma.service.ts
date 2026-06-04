import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Thin wrapper around the generated Prisma client (CLAUDE.md rule #4 — Prisma
 * only). Inject it via `PrismaModule`; never instantiate `new PrismaClient()`
 * elsewhere.
 *
 * Tenant isolation is enforced primarily by **Postgres RLS** (see
 * `prisma/rls.sql`, CLAUDE.md §4.3). Services also pass `tenantId` in every
 * `where` clause as defence in depth.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
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
   * `prisma/rls.sql`.
   *
   * Use this for request paths that rely on RLS. `set_config(..., true)` makes
   * the setting transaction-local, which is safe under connection pooling.
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
      return work(tx);
    });
  }
}
