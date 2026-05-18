#!/usr/bin/env bash
# restart.sh — install deps, start infrastructure, run migrations, start all services.

set -euo pipefail

ulimit -n 65536 2>/dev/null || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

WEB_PORT=${WEB_PORT:-3000}
API_PORT=${API_PORT:-3001}

echo "→ killing anything on ports $WEB_PORT and $API_PORT"
for port in "$WEB_PORT" "$API_PORT"; do
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  stopping $pids on :$port"
    kill -9 $pids 2>/dev/null || true
  fi
done

echo "→ installing dependencies"
pnpm install

# ── start infrastructure ──────────────────────────────────────────────────────
# Read the DB setup mode written by create-ai-app-template, or fall back to
# docker if docker-compose.yml exists (handles manually-created projects).
DBSETUP="local"
if [ -f .dbsetup ]; then
  DBSETUP=$(cat .dbsetup)
fi

if [ "$DBSETUP" = "docker" ] && [ -f docker-compose.yml ]; then
  echo "→ starting Docker services"
  docker compose up -d

  echo "→ waiting for PostgreSQL to accept connections"
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
  DB_HOST=$(node -e "
    const u = process.env.DATABASE_URL || '';
    const m = u.match(/\/\/[^:@]*(?::[^@]*)?@([^:/]+)/);
    process.stdout.write(m ? m[1] : 'localhost');
  ")
  DB_PORT=$(node -e "
    const u = process.env.DATABASE_URL || '';
    const m = u.match(/:(\d+)\//);
    process.stdout.write(m ? m[1] : '5432');
  ")
  for i in $(seq 1 30); do
    if pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; then
      echo "  PostgreSQL is ready"
      break
    fi
    # fallback: TCP check when pg_isready is unavailable
    if node -e "
      const net = require('net');
      const s = net.createConnection($DB_PORT, '$DB_HOST');
      s.on('connect', () => { s.destroy(); process.exit(0); });
      s.on('error', () => process.exit(1));
    " 2>/dev/null; then
      echo "  PostgreSQL is ready"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "  timed out waiting for PostgreSQL — check docker compose logs"
      exit 1
    fi
    sleep 1
  done
fi

echo "→ running pending migrations"
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Safety-net: create the database if it does not yet exist (e.g. dropped manually
# or first run on a machine that skipped the scaffold). The primary creation happens
# in the scaffold (create package) using the postgres npm package. Here we fall back
# to CLI tools, passing PGPASSWORD from DATABASE_URL so no interactive prompt appears.
DB_NAME=$(node -e "
  const u = process.env.DATABASE_URL || '';
  const m = u.match(/\/([^/?#]+)(?:\?|#|$)/);
  process.stdout.write(m ? m[1] : '');
")
DB_HOST=$(node -e "
  const u = process.env.DATABASE_URL || '';
  const m = u.match(/\/\/[^:@]*(?::[^@]*)?@([^:/]+)/);
  process.stdout.write(m ? m[1] : 'localhost');
")
DB_PORT=$(node -e "
  const u = process.env.DATABASE_URL || '';
  const m = u.match(/:(\d+)\//);
  process.stdout.write(m ? m[1] : '5432');
")
DB_USER=$(node -e "
  const u = process.env.DATABASE_URL || '';
  const m = u.match(/\/\/([^:@]+)(?::[^@]*)?@/);
  process.stdout.write(m ? m[1] : 'postgres');
")
DB_PASS=$(node -e "
  const u = process.env.DATABASE_URL || '';
  const m = u.match(/\/\/[^:@]+:([^@]*)@/);
  process.stdout.write(m ? m[1] : '');
")
if [ -n "$DB_NAME" ]; then
  PGPASSWORD="$DB_PASS" createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" 2>/dev/null \
    || PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
         -c "CREATE DATABASE \"$DB_NAME\"" >/dev/null 2>&1 \
    || true
fi

# packages/adapters/package.json exists in the template repo but is removed when
# a project is scaffolded (the package becomes a versioned npm dependency).
# In template mode: use pnpm --filter to run drizzle-kit migrate.
# In scaffolded mode: pnpm --filter finds no workspace package; instead call
# the exported runMigrations() function from the installed npm package.
if [ -f packages/adapters/package.json ]; then
  ADAPTERS_PKG=$(node -e "process.stdout.write(require('./packages/adapters/package.json').name)")
  pnpm --filter "$ADAPTERS_PKG" db:migrate || {
    echo "  migration failed — check DATABASE_URL in .env"
    exit 1
  }
else
  FRAMEWORK_SCOPE=$(cat .framework-scope 2>/dev/null || echo "@rbrasier")
  ADAPTERS_PKG="${FRAMEWORK_SCOPE}/adapters"
  # @rbrasier/adapters is a dependency of apps/api, not the project root.
  # Run node from apps/api so module resolution finds the package.
  (cd "$ROOT/apps/api" && node --input-type=module -e "
    import { runMigrations } from '${ADAPTERS_PKG}/db';
    await runMigrations(process.env.DATABASE_URL ?? '');
    console.log('  migrations complete');
  ") || {
    echo "  migration failed — check DATABASE_URL in .env and that pnpm install completed"
    exit 1
  }
fi

echo "→ starting dev servers (Ctrl-C to stop)"
exec pnpm turbo dev
