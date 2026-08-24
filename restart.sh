#!/usr/bin/env bash
# restart.sh — install deps, start infrastructure, run migrations, start all services.
#
# Flags:
#   --with-mocks, --mocks   Start the shared mocks HTTP server (mocks/server.mjs)
#                           on MOCKS_PORT (default 4001). All local mocks share
#                           this one port; each mock owns a URL path — e.g. the
#                           MCP tools mock is at :4001/mcp, the mock Entra
#                           identity provider at :4001/entra, the mock Microsoft
#                           Graph at :4001/graph, the mock HR roster at :4001/hr,
#                           and the mock PKI reverse proxy at :4001/pki. To add a new mock,
#                           follow the instructions at the top of
#                           mocks/server.mjs and pick a new path (not a new port).
#                           This flag also points Entra sign-in at the mock via
#                           ENTRA_AUTHORITY, and the directory adapters at the
#                           mock Graph via M365_GRAPH_BASE_URL / M365_AUTHORITY.
#                           It does not enable Entra or Graph or fill in
#                           credentials — it prints the values to paste into
#                           /admin/settings and .env, so a mocked install starts
#                           with the same auth methods as any other.
#
#   --with-pki              Implies --with-mocks, and additionally boots the web
#                           app in PKI mode so the mock proxy at
#                           :4001/pki/connect can mint sessions. PKI is the one
#                           method with no /admin/settings switch: AUTH_METHOD is
#                           read at boot and also decides where middleware.ts
#                           sends unauthenticated requests, so it can only come
#                           from the environment. This flag exports what the run
#                           needs and prints the same block for .env, rather than
#                           enabling anything behind your back.

set -euo pipefail

ulimit -n 65536 2>/dev/null || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

WEB_PORT=${WEB_PORT:-3000}
API_PORT=${API_PORT:-3001}
MOCKS_PORT=${MOCKS_PORT:-4001}

WITH_MOCKS=0
WITH_PKI=0
for arg in "$@"; do
  case "$arg" in
    --with-mocks|--mocks)
      WITH_MOCKS=1
      ;;
    --with-pki|--pki)
      WITH_MOCKS=1
      WITH_PKI=1
      ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "unknown flag: $arg" >&2
      exit 1
      ;;
  esac
done

PORTS_TO_KILL=("$WEB_PORT" "$API_PORT")
if [ "$WITH_MOCKS" -eq 1 ]; then
  PORTS_TO_KILL+=("$MOCKS_PORT")
fi

echo "→ killing anything on ports ${PORTS_TO_KILL[*]}"
for port in "${PORTS_TO_KILL[@]}"; do
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  stopping $pids on :$port"
    kill -9 $pids 2>/dev/null || true
  fi
done

echo "→ installing dependencies"
pnpm install

# ── ensure the bootstrap secrets exist ────────────────────────────────────────
# The zero-env quick-start needs no hand-edited .env: seed it from .env.example
# and auto-generate the two secrets the app structurally requires. Everything
# else is configured in-app via the first-run setup wizard (ADR-041).
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "  created .env from .env.example"
fi

# ensure_secret VAR — generate a 32-byte hex value for VAR if it is missing or
# blank in .env. Secret-bearing system settings are encrypted at rest with
# SETTINGS_ENCRYPTION_KEY, and Better Auth signs sessions with BETTER_AUTH_SECRET;
# both apps require these at startup. SCHEDULER_TICK_SECRET is what the API's
# heartbeat presents to the web tick endpoint — without it the scheduler never
# starts and scheduled sessions never fire.
ensure_secret() {
  var="$1"
  if [ ! -f .env ]; then return; fi
  if grep -q "^${var}=.\+" .env; then return; fi
  generated=$(openssl rand -hex 32 2>/dev/null || node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  if grep -q "^${var}=" .env; then
    tmp_env=$(mktemp)
    grep -v "^${var}=" .env > "$tmp_env"
    printf '%s=%s\n' "$var" "$generated" >> "$tmp_env"
    mv "$tmp_env" .env
  else
    printf '%s=%s\n' "$var" "$generated" >> .env
  fi
  echo "  generated ${var} into .env"
}

ensure_secret SETTINGS_ENCRYPTION_KEY
ensure_secret BETTER_AUTH_SECRET
ensure_secret SCHEDULER_TICK_SECRET

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

  # ── wait for MinIO ────────────────────────────────────────────────────────
  MINIO_EP="${MINIO_ENDPOINT:-}"
  MINIO_P="${MINIO_PORT:-}"
  if [ -n "$MINIO_EP" ] && [ -n "$MINIO_P" ]; then
    echo "→ waiting for MinIO at $MINIO_EP:$MINIO_P"
    for i in $(seq 1 15); do
      if node -e "
        const http = require('http');
        const req = http.get('http://${MINIO_EP}:${MINIO_P}/minio/health/live', (res) => {
          process.exit(res.statusCode === 200 ? 0 : 1);
        });
        req.on('error', () => process.exit(1));
        req.setTimeout(2000, () => { req.destroy(); process.exit(1); });
      " 2>/dev/null; then
        echo "  MinIO is ready"
        break
      fi
      if [ "$i" -eq 15 ]; then
        echo "  MinIO not reachable at $MINIO_EP:$MINIO_P — is it running?"
        exit 1
      fi
      sleep 2
    done
  fi
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
  # Generated migrations are the only thing that alters the schema. This asks
  # the one question the old `drizzle-kit push` step was there for — has the
  # schema been edited without generating a migration? — by diffing the schema
  # against its own snapshot instead of against the live database, so it never
  # offers to truncate a table and it stops complaining once a migration exists.
  echo "→ checking the schema matches its migrations"
  pnpm --filter "$ADAPTERS_PKG" -s db:drift || {
    echo "  starting anyway — the app will run against the migrated schema, not the edited one"
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

if [ "$WITH_MOCKS" -eq 1 ]; then
  echo "→ starting mocks on :$MOCKS_PORT"
  mkdir -p "$ROOT/.mocks-logs"
  log="$ROOT/.mocks-logs/server.log"
  (cd "$ROOT/mocks" && MOCKS_PORT="$MOCKS_PORT" node server.mjs) >"$log" 2>&1 &
  echo "  mocks server pid $! (logs: .mocks-logs/server.log)"

  # Point Entra sign-in at the mock identity provider, and *only* that. The
  # credentials are deliberately not exported: a full set of ENTRA_* env vars
  # switches Entra on by itself (ADR-025 §1 — env-only deployments keep the DB
  # row optional), so exporting them here would silently enable Entra on every
  # mocked install. The mock exists to give a real deployment something to test
  # against, not to turn the feature on, so the values are printed to paste in.
  export ENTRA_AUTHORITY="http://localhost:$MOCKS_PORT/entra"
  cat <<EOF
  mock Entra at $ENTRA_AUTHORITY
  To use it, open /admin/settings → Authentication, switch Microsoft Entra ID on
  and paste these (the mock accepts any values; these just have to be non-empty):
    Tenant ID      mock-tenant
    Client ID      mock-client
    Client secret  mock-secret

  mock lookup sources at http://localhost:$MOCKS_PORT/lookup/...
  Three value sets for external-sourced template fields, registered at
  /admin/settings -> Lookup Sources. Paste the credential verbatim, the scheme
  word included -- it is sent as the Authorization header as typed.

    contract-types   8 entries, no credential      display name / key code
      url            http://localhost:$MOCKS_PORT/lookup/contract-types
      records path   (leave empty -- the body is the array)

    skills           60 entries                    display skill_name / key skill_code
      url            http://localhost:$MOCKS_PORT/lookup/skills
      records path   data
      credential     Bearer wf-mock-skills-2f9a1c7d

    business-units   5,000 entries                 display unit_name / key unit_code
      url            http://localhost:$MOCKS_PORT/lookup/business-units
      records path   items
      credential     Basic YnUtc2VydmljZTpzM2NyM3QtbW9jay1wdw==
      pagination     offset - param offset - size param limit - size 250
      Set the size to 250: the walk stops after 20 pages, so the default 200
      reaches only 4,000 of the 5,000.
EOF

  # Point the directory adapters at the mock Graph, and *only* that. Same
  # reasoning as Entra above: a full set of M365_* credentials switches the
  # approver directory on by itself, so exporting those would put every mocked
  # install onto Graph behind the operator's back. These two are host overrides —
  # inert until the directory is configured — so they are safe to export, and
  # they are the half that cannot be set from the admin UI anyway.
  export M365_GRAPH_BASE_URL="http://localhost:$MOCKS_PORT/graph/v1.0"
  export M365_AUTHORITY="http://localhost:$MOCKS_PORT/entra"
  cat <<EOF
  mock HR roster at http://localhost:$MOCKS_PORT/hr
  100 employees across five reporting levels, shared by every mock here. Save it:
    curl -sSO http://localhost:$MOCKS_PORT/hr/employees.csv
  Upload it at /admin/settings → HR Directory Data, then map the columns:
    Employee Email → Email        Job Title     → Position / role
    Full Name      → Display name Grade         → Band / grade
    Manager Email  → Manager      Business Unit → Business unit
  Leave Employee ID, Location and Start Date unmapped.

  mock Microsoft Graph at http://localhost:$MOCKS_PORT/graph/v1.0
  Serves the same people, so first/second-level approver resolution can be driven
  on its Graph path instead of the HR-column fallback. The host overrides were
  exported for this run; the credentials are not, because they switch the
  directory on. To use it, open /admin/settings → Approver Directory, switch
  directory lookups on, choose "Enter separate credentials" and paste these
  (the mock accepts any values; these just have to be non-empty):
    Tenant ID      mock-tenant
    Client ID      mock-client
    Client secret  mock-secret
EOF

  # Where the mock PKI proxy forwards the certificates it issues. Safe to export
  # unconditionally: it configures the mock, not the app, and nothing reaches the
  # mock unless you open its picker.
  export MOCK_PKI_APP_ORIGIN="${MOCK_PKI_APP_ORIGIN:-http://localhost:$WEB_PORT}"

  if [ "$WITH_PKI" -eq 1 ]; then
    # PKI is the one method with no /admin/settings switch, so unlike Entra above
    # there is nothing to paste into the app: the container builds PkiCertAdapter
    # only when AUTH_METHOD names PKI, the adapter refuses to construct with an
    # empty trusted-proxy list, and middleware.ts reads AUTH_METHOD too. Exporting
    # is therefore the only way to honour the flag — but it lasts for this run
    # only, so print the same block for .env rather than editing it silently.
    export AUTH_METHOD="pki-and-email-password"
    export PKI_TRUSTED_PROXY_IPS="${PKI_TRUSTED_PROXY_IPS:-127.0.0.1}"
    export PKI_SESSION_TTL_HOURS="${PKI_SESSION_TTL_HOURS:-8}"
    cat <<EOF
  mock PKI at http://localhost:$MOCKS_PORT/pki
  PKI mode is on for this run only — these were exported, not written to .env.
  To keep it on across plain \`./restart.sh\` runs, put this in .env:
    AUTH_METHOD=$AUTH_METHOD
    PKI_TRUSTED_PROXY_IPS=$PKI_TRUSTED_PROXY_IPS
    PKI_SESSION_TTL_HOURS=$PKI_SESSION_TTL_HOURS
  Then present a certificate at
    http://localhost:$MOCKS_PORT/pki/connect?redirect=/chats
  Email/password still works alongside it; drop the "-and-email-password" suffix
  for certificate-only sign-in.
EOF
  else
    cat <<EOF
  mock PKI at http://localhost:$MOCKS_PORT/pki
  The app is not in PKI mode, so its picker will be refused (the cert route 404s
  until AUTH_METHOD names PKI). Re-run with --with-pki to boot in PKI mode.
EOF
  fi
fi

echo "→ starting dev servers (Ctrl-C to stop)"
exec pnpm turbo dev
