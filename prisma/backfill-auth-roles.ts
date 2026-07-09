/**
 * One-off backfill for the AuthRole migration: maps the legacy string role keys
 * (`profile_key` / `role_key`) to the new `auth_role_id` FK.
 *
 * Run ONCE, in this order, when migrating a database that still holds the legacy
 * columns:
 *   1. add the AuthRole model + nullable `auth_role_id` columns → `prisma db push`
 *   2. `prisma db seed` (creates the global system roles)
 *   3. this script → `pnpm exec ts-node prisma/backfill-auth-roles.ts`
 *   4. make `auth_role_id` NOT NULL + drop the legacy columns → `prisma db push`
 *
 * Every existing role key is one of the seeded system roles (tenant_id NULL), so
 * each table is filled with a single set-based UPDATE joined on `key`. Uses raw
 * SQL (so it is independent of the generated client, which no longer knows the
 * dropped columns) and is idempotent — only rows with a NULL `auth_role_id` are
 * touched. The app connects as a superuser here, so the cross-tenant UPDATEs are
 * not blocked by RLS; on a least-privilege connection, run per-tenant with the
 * `app.current_tenant_id` GUC set (see the RLS data-migration convention).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** A legacy column → its owning table, all mapped to system roles by key. */
const TABLES: Array<{ table: string; column: string }> = [
  { table: 'user_branch_profiles', column: 'profile_key' },
  { table: 'tenant_staff_memberships', column: 'role_key' },
  { table: 'user_profile_permission_overrides', column: 'profile_key' },
  { table: 'refresh_tokens', column: 'profile_key' },
];

async function main() {
  const roleRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM auth_roles WHERE tenant_id IS NULL AND deleted_at IS NULL
  `;
  if ((roleRows[0]?.count ?? 0n) === 0n) {
    throw new Error(
      'No system roles found — run `pnpm prisma db seed` before backfilling.',
    );
  }

  for (const { table, column } of TABLES) {
    const affected = await prisma.$executeRawUnsafe(
      `UPDATE ${table} AS t
         SET auth_role_id = r.id
         FROM auth_roles r
        WHERE t.${column} = r.key
          AND r.tenant_id IS NULL
          AND t.auth_role_id IS NULL`,
    );
    console.log(`${table}: mapped ${affected} row(s).`);
  }

  const orphanRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM user_branch_profiles WHERE auth_role_id IS NULL
  `;
  const orphans = orphanRows[0]?.count ?? 0n;
  console.log(`Backfill complete. user_branch_profiles with no role: ${orphans}.`);
  if (orphans > 0n) {
    console.warn(
      'Resolve the remaining rows before making auth_role_id NOT NULL.',
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
