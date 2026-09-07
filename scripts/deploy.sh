#!/usr/bin/env bash
# Deploy kalnostics-new (NestJS backend) on this server: pull, build, migrate, restart.
#
# Same rationale as kaltros-fe/scripts/deploy.sh: this droplet is low on RAM
# and a build can be OOM-killed partway through, leaving dist/ incomplete.
# This script keeps the last known-good dist/ around and only ever leaves a
# verified build in place.
#
# DB migrations ALWAYS run before restart — there is no --with-migrations
# opt-out anymore. A backend restarted on a stale schema 500s on every
# endpoint touching a migrated table/column (2026-09-06 incident: 7 unapplied
# migrations took down /orders, /accession/settings, etc. for who knows how
# long because a deploy skipped this step). Migrations are NOT rolled back
# automatically if a later step fails, so a failed migration aborts the
# deploy outright — pm2 is never restarted onto a half-migrated schema.
#
# Migrations run with an OWNER-level credential (MIGRATE_DATABASE_URL from
# .env.migrate, chmod 600, gitignored, never read by the app itself) because
# the app's own DATABASE_URL (kalnostics_app) is an intentionally
# least-privileged, non-owner role for RLS (see .env.example) — it has no
# CREATE on schema public and doesn't own the tables, so it cannot run DDL.
set -euo pipefail

REPO_DIR="/opt/kalnostics/kalnostics-new"
BRANCH="main"
for arg in "$@"; do
  case "$arg" in
    --with-migrations)
      echo "NOTE: --with-migrations is a no-op now — migrations always run. Ignoring." >&2
      ;;
    *) BRANCH="$arg" ;;
  esac
done
PM2_APP="kalnostics-backend"
DIST="$REPO_DIR/dist"
DIST_BAK="$REPO_DIR/dist.bak"
MIGRATE_ENV_FILE="$REPO_DIR/.env.migrate"

cd "$REPO_DIR"

echo "==> Checking working tree is clean (ignoring untracked files)"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "ERROR: working tree has uncommitted changes — aborting so nothing gets clobbered." >&2
  git status --short
  exit 1
fi

echo "==> Pulling origin/$BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH" --no-ff

echo "==> Installing dependencies (frozen lockfile)"
pnpm install --frozen-lockfile

echo "==> Generating Prisma client"
pnpm exec prisma generate

echo "==> Backing up current dist/ before building"
rm -rf "$DIST_BAK"
if [[ -d "$DIST" ]]; then
  cp -a "$DIST" "$DIST_BAK"
fi

restore_backup() {
  if [[ -d "$DIST_BAK" ]]; then
    rm -rf "$DIST"
    cp -a "$DIST_BAK" "$DIST"
  fi
}

echo "==> Building"
if ! NODE_OPTIONS="--max-old-space-size=2048" pnpm run build; then
  echo "ERROR: build failed — restoring previous dist/, nothing deployed." >&2
  restore_backup
  exit 1
fi

echo "==> Verifying build output"
if [[ ! -f "$DIST/src/main.js" ]]; then
  echo "ERROR: build finished but dist/src/main.js is missing." >&2
  echo "==> Restoring previous dist/ to avoid an outage." >&2
  restore_backup
  exit 1
fi

echo "==> Applying database migrations (prisma migrate deploy)"
if [[ ! -f "$MIGRATE_ENV_FILE" ]]; then
  echo "ERROR: $MIGRATE_ENV_FILE not found — refusing to deploy without applying migrations." >&2
  echo "    Create it (chmod 600) with:  MIGRATE_DATABASE_URL=<owner-role connection string>" >&2
  restore_backup
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$MIGRATE_ENV_FILE"; set +a
if [[ -z "${MIGRATE_DATABASE_URL:-}" ]]; then
  echo "ERROR: MIGRATE_DATABASE_URL is not set in $MIGRATE_ENV_FILE." >&2
  restore_backup
  exit 1
fi
if ! DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm exec prisma migrate deploy; then
  echo "ERROR: migration failed — aborting deploy WITHOUT restarting pm2." >&2
  echo "    The running app is untouched (still the old dist/). Resolve the migration" >&2
  echo "    (https://pris.ly/d/migrate-resolve) before retrying the deploy." >&2
  restore_backup
  exit 1
fi

echo "==> Build verified, migrations applied. Restarting pm2 app: $PM2_APP"
pm2 restart "$PM2_APP"

echo "==> Health-checking the app"
ok=false
for _ in $(seq 1 10); do
  sleep 1
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/v1 || echo 000)
  if [[ "$code" != "000" && ! "$code" =~ ^5 ]]; then
    ok=true
    break
  fi
done

if [[ "$ok" != true ]]; then
  echo "ERROR: app did not come up healthy after restart — rolling back dist/." >&2
  echo "    WARNING: migrations were already applied above and are NOT rolled back —" >&2
  echo "    check DB/code compatibility manually before redeploying." >&2
  restore_backup
  pm2 restart "$PM2_APP"
  exit 1
fi

rm -rf "$DIST_BAK"
echo "==> Deploy successful: $BRANCH is live and healthy."
