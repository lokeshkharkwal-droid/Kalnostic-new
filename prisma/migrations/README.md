# Prisma migrations — Kalnostics New

This folder is the **deployable** migration history. Applying it to an empty
PostgreSQL database with `prisma migrate deploy` produces a database identical to
`prisma/schema.prisma`, **including** Row-Level Security and the partial unique
indexes Prisma can't express in the schema.

## Layout

| Migration                 | What it does |
| ------------------------- | ------------ |
| `0_init`                  | The **squashed baseline** — the entire current schema (all tables, enums, indexes, FKs) generated from `prisma/schema.prisma`. |
| `1_row_level_security`    | A snapshot of `prisma/rls.sql` — enables RLS + tenant-isolation policies on every tenant-scoped table, and creates the partial (`WHERE deleted_at IS NULL`) unique indexes. Runs after `0_init`, so every table it references already exists. |

### Why a single squashed baseline?

Development ran against the database with `prisma db push` for a long stretch, so
the original per-feature migration **files were never kept** — the database held
migration *records* the folder no longer had. That divergence is exactly what
made a fresh server hard to set up. Rather than reconstruct ~45 lost files, the
history was **squashed to one baseline** that reproduces the current schema
exactly (verified with `prisma migrate diff --from-migrations … --to-schema-datamodel`,
which reports an empty diff).

## Deploying to a NEW / empty database

```bash
# 1. schema + RLS + partial indexes, in one step:
DATABASE_URL="$ADMIN_DB_URL" pnpm prisma migrate deploy
# 2. (optional) seed reference data:
DATABASE_URL="$ADMIN_DB_URL" pnpm prisma db seed
```

`deploy/deploy.sh` already runs `prisma migrate deploy` with the admin role, so a
new server is fully provisioned by the normal deploy — **no separate `psql -f
rls.sql` step is required** any more.

> Use an **admin/owner** role for `migrate deploy` (it must ALTER tables and
> CREATE policies). The **application** connection role must NOT be the table
> owner and must NOT have `BYPASSRLS`, or RLS won't be enforced.

## Baselining an EXISTING database (already has the schema via db push)

Mark the baseline migrations as already-applied so their DDL isn't re-run:

```bash
# Only if the _prisma_migrations ledger is empty or divergent — clear it first:
#   DELETE FROM _prisma_migrations;
pnpm prisma migrate resolve --applied 0_init
pnpm prisma migrate resolve --applied 1_row_level_security
pnpm prisma migrate status      # -> "Database schema is up to date!"
```

The dev database has already been reconciled this way.

## Changing the schema from here on

Ordinary Prisma workflow — the folder and the database now agree, so
`prisma migrate dev --name <change>` works again and produces a normal
incremental migration.

- **RLS / partial-index changes:** `prisma/rls.sql` stays the source of truth
  (it's re-applied idempotently during local `db push`). When it changes, also
  add a **new** migration that re-runs the full, updated `rls.sql` — it is
  written to be idempotent (`DROP … IF EXISTS` / `CREATE … IF NOT EXISTS` /
  `FORCE ROW LEVEL SECURITY`), so re-running the whole file is safe.
- Do **not** edit a migration's `migration.sql` after it has been applied
  anywhere — Prisma checksums them and `migrate deploy` will refuse a modified
  migration.
