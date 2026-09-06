#!/usr/bin/env bash
# Deploy kalnostics-new (NestJS backend) on this server: pull, build, verify, restart.
#
# Same rationale as kaltros-fe/scripts/deploy.sh: this droplet is low on RAM
# and a build can be OOM-killed partway through, leaving dist/ incomplete.
# This script keeps the last known-good dist/ around and only ever leaves a
# verified build in place.
#
# DB migrations are opt-in (--with-migrations) and are NOT rolled back
# automatically — a schema change can't be undone by restoring an old dist/,
# so treat that step as a deliberate, separate decision each deploy.
set -euo pipefail

REPO_DIR="/opt/kalnostics/kalnostics-new"
BRANCH="main"
RUN_MIGRATIONS=false
for arg in "$@"; do
  case "$arg" in
    --with-migrations) RUN_MIGRATIONS=true ;;
    *) BRANCH="$arg" ;;
  esac
done
PM2_APP="kalnostics-backend"
DIST="$REPO_DIR/dist"
DIST_BAK="$REPO_DIR/dist.bak"

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

if [[ "$RUN_MIGRATIONS" == true ]]; then
  echo "==> Applying database migrations (prisma migrate deploy)"
  echo "    NOTE: migrations are not rolled back automatically if a later step fails." >&2
  pnpm exec prisma migrate deploy
else
  echo "==> Skipping migrations (pass --with-migrations to apply pending prisma migrations)"
fi

echo "==> Build verified. Restarting pm2 app: $PM2_APP"
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
  if [[ "$RUN_MIGRATIONS" == true ]]; then
    echo "    WARNING: migrations were applied above and are still in place — check DB/code compatibility manually." >&2
  fi
  restore_backup
  pm2 restart "$PM2_APP"
  exit 1
fi

rm -rf "$DIST_BAK"
echo "==> Deploy successful: $BRANCH is live and healthy."
