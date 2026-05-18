#!/usr/bin/env bash
# validate.sh — runs every check that must pass before any change can ship.
#
# Exits non-zero on any failure. Each check prints PASS / FAIL.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "${GREEN}PASS${NC} — $1"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}FAIL${NC} — $1"; FAIL=$((FAIL + 1)); }
skip() { echo -e "${YELLOW}SKIP${NC} — $1"; }
section() { echo; echo -e "${YELLOW}── $1 ──${NC}"; }

# ── 1. typecheck ──────────────────────────────────────────────────────────────
section "1. pnpm typecheck"
if pnpm -s typecheck; then pass "typecheck"; else fail "typecheck"; fi

# ── 2. lint ───────────────────────────────────────────────────────────────────
section "2. pnpm lint"
if pnpm -s lint; then pass "lint"; else fail "lint"; fi

# ── 3. tests ──────────────────────────────────────────────────────────────────
section "3. pnpm test"
if pnpm -s test; then pass "tests"; else fail "tests"; fi

# ── 4. drizzle schema check ───────────────────────────────────────────────────
section "4. drizzle-kit check"
if [ -z "${DATABASE_URL:-}" ]; then
  skip "drizzle schema check — DATABASE_URL not set"
elif ! node -e "
  const url = process.env.DATABASE_URL;
  const m = url.match(/[@]([^:/]+):?([0-9]*)\//);
  const host = m?.[1] ?? 'localhost';
  const port = parseInt(m?.[2] || '5432');
  const net = require('net');
  const s = net.createConnection({ host, port });
  s.on('connect', () => { s.destroy(); process.exit(0); });
  s.on('error', () => process.exit(1));
" 2>/dev/null; then
  skip "drizzle schema check — database not reachable (run ./validate.sh once docker compose is up)"
else
  if pnpm --filter "@rbrasier/adapters" -s db:check; then
    pass "drizzle schema"
  else
    fail "drizzle schema"
  fi
fi

# ── 5. domain purity ──────────────────────────────────────────────────────────
section "5. packages/domain has no external imports"
DOMAIN_LEAKS=$(grep -rnE "from ['\"][^.]" packages/domain/src \
    --include="*.ts" --exclude="*.test.ts" 2>/dev/null \
  | grep -vE "from ['\"]\\." \
  | grep -vE "^[^:]+:[0-9]+:\s*//")
if [ -z "$DOMAIN_LEAKS" ]; then
  pass "domain purity"
else
  fail "domain purity — non-relative imports found:"
  echo "$DOMAIN_LEAKS"
fi

# ── 6. table naming convention ────────────────────────────────────────────────
section "6. all Drizzle tables match ^(core|ai|kb|admin|app|job)_[a-z_]+\$"
SCHEMA_DIR="packages/adapters/src/db/schema"
BAD_TABLES=$(grep -rhE "pgTable\(\"[^\"]+\"" "$SCHEMA_DIR" 2>/dev/null \
  | sed -E 's/.*pgTable\("([^"]+)".*/\1/' \
  | grep -vE "^(core|ai|kb|admin|app|job)_[a-z_]+$" || true)
if [ -z "$BAD_TABLES" ]; then
  pass "table names"
else
  fail "table names — these violate the prefix rule:"
  echo "$BAD_TABLES"
fi

# ── 7. version sync ───────────────────────────────────────────────────────────
section "7. VERSION matches root package.json version"
VERSION_FILE=$(tr -d '[:space:]' < VERSION)
PKG_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
if [ "$VERSION_FILE" = "$PKG_VERSION" ]; then
  pass "version sync ($VERSION_FILE)"
else
  fail "version mismatch — VERSION='$VERSION_FILE' package.json='$PKG_VERSION'"
fi

# ── 8. doc lifecycle ──────────────────────────────────────────────────────────
# For each file in to-be-implemented/, fail if any implementation summary
# in implemented/ references it as completed (means it should have been moved).
section "8. doc lifecycle — to-be-implemented/* not referenced as done in implemented/"
DOC_VIOLATIONS=""
if [ -d docs/development/to-be-implemented ] && [ -d docs/development/implemented ]; then
  while IFS= read -r doc; do
    base=$(basename "$doc")
    # Skip README and any "_*.md" meta files — only phase docs are tracked.
    case "$base" in
      README.md|_*) continue ;;
    esac
    if grep -rl --include="*.md" "$base" docs/development/implemented/ > /dev/null 2>&1; then
      DOC_VIOLATIONS+="$doc referenced in implemented/\n"
    fi
  done < <(find docs/development/to-be-implemented -type f -name "*.md" 2>/dev/null)
fi
if [ -z "$DOC_VIOLATIONS" ]; then
  pass "doc lifecycle"
else
  fail "doc lifecycle:"
  printf '%b' "$DOC_VIOLATIONS"
fi

# ── 9. health checker wiring ──────────────────────────────────────────────────
# Verify every required health-checker adapter class exists in the codebase
# so no derived app ships without them wired.
section "9. health checker adapters exist in codebase"
HEALTH_FILES=(
  "packages/adapters/src/health/db-health-checker.ts"
  "packages/adapters/src/health/redis-health-checker.ts"
  "packages/adapters/src/health/ai-health-checker.ts"
  "packages/adapters/src/health/composite-health-checker.ts"
)
MISSING_HEALTH=""
for f in "${HEALTH_FILES[@]}"; do
  [ -f "$f" ] || MISSING_HEALTH+="  missing: $f\n"
done
if [ -z "$MISSING_HEALTH" ]; then
  pass "health checker adapters present"
else
  fail "health checker adapters missing:"
  printf '%b' "$MISSING_HEALTH"
fi

# Verify CompositeHealthChecker is wired into the API container
if grep -q "CompositeHealthChecker" apps/api/src/container.ts 2>/dev/null; then
  pass "CompositeHealthChecker wired in API container"
else
  fail "CompositeHealthChecker not found in apps/api/src/container.ts"
fi

# ── 10. external service connectivity (WARN only — never blocks CI) ───────────
section "10. external service connectivity (informational)"
warn() { echo -e "${YELLOW}WARN${NC} — $1"; }

# Postgres
if command -v pg_isready &>/dev/null && [ -n "${DATABASE_URL:-}" ]; then
  # Extract host and port from DATABASE_URL
  PG_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
  PG_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
  PG_PORT="${PG_PORT:-5432}"
  if pg_isready -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null; then
    pass "postgres reachable ($PG_HOST:$PG_PORT)"
  else
    warn "postgres not reachable at $PG_HOST:$PG_PORT (expected in CI — ignore if no DB)"
  fi
else
  warn "postgres connectivity skipped (pg_isready not found or DATABASE_URL not set)"
fi

# Redis
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
REDIS_HOST=$(echo "$REDIS_URL" | sed -E 's|redis://([^:/]+).*|\1|')
REDIS_PORT=$(echo "$REDIS_URL" | sed -E 's|redis://[^:]+:([0-9]+).*|\1|')
REDIS_PORT="${REDIS_PORT:-6379}"
if command -v redis-cli &>/dev/null; then
  if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
    pass "redis reachable ($REDIS_HOST:$REDIS_PORT)"
  else
    warn "redis not reachable at $REDIS_HOST:$REDIS_PORT (expected in CI — ignore if no Redis)"
  fi
else
  warn "redis connectivity skipped (redis-cli not found)"
fi

# AI provider key
AI_PROVIDER="${AI_DEFAULT_PROVIDER:-anthropic}"
case "$AI_PROVIDER" in
  anthropic)  KEY_VAR="ANTHROPIC_API_KEY" ;;
  openai)     KEY_VAR="OPENAI_API_KEY" ;;
  mistral)    KEY_VAR="MISTRAL_API_KEY" ;;
  *)          KEY_VAR="" ;;
esac
if [ -n "${KEY_VAR:-}" ] && [ -n "${!KEY_VAR:-}" ]; then
  pass "AI provider key set ($AI_PROVIDER)"
else
  warn "AI provider key not set for '$AI_PROVIDER' (set ${KEY_VAR:-ANTHROPIC_API_KEY} to suppress)"
fi

# ── 11. publishable packages ──────────────────────────────────────────────────
section "11. publishable packages have no 'private: true'"
PUBLISHED_PKGS=(
  "packages/domain/package.json"
  "packages/shared/package.json"
  "packages/application/package.json"
  "packages/adapters/package.json"
)
# Detect whether the template scope has been replaced with a real org/user scope.
# While still @template/* the packages must remain private so CI doesn't attempt
# to publish to a registry with a non-existent scope.
SCOPE=$(node -e "process.stdout.write(require('./packages/domain/package.json').name.split('/')[0])" 2>/dev/null)
if [ "$SCOPE" = "@template" ]; then
  pass "publishable packages check skipped — scope is still @template (template not yet bootstrapped)"
else
  PUB_VIOLATIONS=""
  for pkg in "${PUBLISHED_PKGS[@]}"; do
    if [ -f "$pkg" ]; then
      if node -e "const p = require('./${pkg}'); if (p.private) process.exit(1)" 2>/dev/null; then
        : # not private — good
      else
        PUB_VIOLATIONS+="  $pkg has private: true\n"
      fi
    fi
  done
  if [ -z "$PUB_VIOLATIONS" ]; then
    pass "published packages are not marked private"
  else
    fail "publishable packages should not have private: true:"
    printf '%b' "$PUB_VIOLATIONS"
  fi

  # Verify each published package has a publishConfig.registry set
  for pkg in "${PUBLISHED_PKGS[@]}"; do
    if [ -f "$pkg" ]; then
      pkg_name=$(node -e "process.stdout.write(require('./${pkg}').name)")
      has_registry=$(node -e "const p = require('./${pkg}'); process.stdout.write(p.publishConfig?.registry ? 'yes' : 'no')" 2>/dev/null)
      if [ "$has_registry" = "yes" ]; then
        pass "publishConfig.registry set in $pkg_name"
      else
        fail "publishConfig.registry missing in $pkg_name"
      fi
    fi
  done
fi

# ── 12. adapters peer dependency ranges are valid semver ─────────────────────
section "12. adapters peer dependency versions are valid semver ranges"
if command -v node &>/dev/null && [ -f "packages/adapters/package.json" ]; then
  BAD_PEERS=$(node -e "
    const pkg = require('./packages/adapters/package.json');
    const peers = pkg.peerDependencies || {};
    // Valid forms: ^1.0.0  ~1.0.0  >=1.0.0  <=1.0.0  >1.0.0  <1.0.0  1.0.0  *  workspace:*
    const semver = /^(\*|workspace:\*|[~^]?\d+\.\d+\.\d+|[<>]=?\d+\.\d+\.\d+)/;
    const bad = Object.entries(peers)
      .filter(([, v]) => !semver.test(String(v)))
      .map(([k, v]) => k + ': ' + v);
    if (bad.length) process.stdout.write(bad.join('\n'));
  " 2>/dev/null)
  if [ -z "$BAD_PEERS" ]; then
    pass "adapters peer dependency versions are valid"
  else
    fail "adapters has invalid peer dependency version ranges:"
    echo "$BAD_PEERS"
  fi
fi

# ── 13. dependency security audit ────────────────────────────────────────────
section "13. pnpm audit (high + critical vulnerabilities)"
if pnpm audit --audit-level=high 2>&1; then
  pass "no high/critical vulnerabilities"
else
  fail "high or critical vulnerabilities found — run 'pnpm audit' for details"
fi

# ── 14. test files exist in domain and application ────────────────────────────
section "14. domain and application packages have tests"
DOMAIN_TESTS=$(find packages/domain/src -name "*.test.ts" 2>/dev/null | wc -l | tr -d ' ')
APP_TESTS=$(find packages/application/src -name "*.test.ts" 2>/dev/null | wc -l | tr -d ' ')
if [ "$DOMAIN_TESTS" -ge 1 ]; then
  pass "packages/domain has $DOMAIN_TESTS test file(s)"
else
  fail "packages/domain has no test files — write tests before shipping"
fi
if [ "$APP_TESTS" -ge 1 ]; then
  pass "packages/application has $APP_TESTS test file(s)"
else
  fail "packages/application has no test files — write tests before shipping"
fi

# ── 15. test coverage meets thresholds (domain + application) ─────────────────
section "15. test coverage thresholds (domain + application)"
DOMAIN_PKG=$(node -e "process.stdout.write(require('./packages/domain/package.json').name)")
APP_PKG=$(node -e "process.stdout.write(require('./packages/application/package.json').name)")
if pnpm --filter "$DOMAIN_PKG" -s test:coverage && \
   pnpm --filter "$APP_PKG" -s test:coverage; then
  pass "coverage meets thresholds"
else
  fail "coverage below thresholds — see output above (targets: 70% lines, 70% functions)"
fi

# ── 16. restart.sh adapters package resolution ───────────────────────────────
section "16. restart.sh resolves adapters package name in scaffolded context"
# A scaffolded project has no packages/ directory — the adapters package is
# consumed as a versioned npm dependency. restart.sh must guard the
# packages/adapters/package.json read with a file-existence check and fall back
# to .framework-scope when the local source tree is absent.
if grep -q "if \[ -f packages/adapters/package.json \]" restart.sh; then
  pass "restart.sh guards adapters package resolution for scaffolded projects"
else
  fail "restart.sh reads packages/adapters/package.json unconditionally — breaks scaffolded projects (no packages/ dir present after scaffold)"
fi

# ── 17. @opentelemetry/* must be dependencies, not peerDependencies ──────────
section "17. @opentelemetry/* packages are dependencies (not peerDependencies) in adapters"
# OTel packages are external in tsup (not bundled) but are implementation details
# of adapters that consuming apps never import directly. They must be in
# dependencies so pnpm installs them when @rbrasier/adapters is consumed as an
# npm package. Declaring them as peerDependencies silently breaks scaffolded
# projects because apps/api never lists them.
OTEL_IN_PEERS=$(node -e "
  const pkg = require('./packages/adapters/package.json');
  const peers = Object.keys(pkg.peerDependencies || {});
  const bad = peers.filter(p => p.startsWith('@opentelemetry/'));
  if (bad.length) process.stdout.write(bad.join(', '));
" 2>/dev/null)
if [ -z "$OTEL_IN_PEERS" ]; then
  pass "@opentelemetry/* packages are not in adapters peerDependencies"
else
  fail "@opentelemetry/* packages declared as peerDependencies in adapters — must be dependencies: $OTEL_IN_PEERS"
fi

# ── 18. restart.sh uses runMigrations in scaffolded mode ─────────────────────
section "18. restart.sh uses runMigrations for scaffolded projects"
# In a scaffolded project pnpm --filter finds no workspace package for adapters.
# restart.sh must detect scaffolded mode and call runMigrations() instead.
if grep -q "runMigrations" restart.sh; then
  pass "restart.sh calls runMigrations in scaffolded mode"
else
  fail "restart.sh does not call runMigrations — scaffolded projects cannot run migrations"
fi

# ── 19. adapters publishes drizzle migration files ────────────────────────────
section "19. adapters package.json includes drizzle migrations in files"
# The runMigrations() function resolves migrations from the published package's
# drizzle/ folder. If that folder is excluded from files, migrations fail.
DRIZZLE_IN_FILES=$(node -e "
  const pkg = require('./packages/adapters/package.json');
  const files = pkg.files || [];
  process.stdout.write(files.includes('drizzle') ? 'yes' : 'no');
" 2>/dev/null)
if [ "$DRIZZLE_IN_FILES" = "yes" ]; then
  pass "adapters publishes drizzle migrations folder"
else
  fail "adapters does not include drizzle in files — runMigrations() cannot find SQL files in scaffolded projects"
fi

# ── 20. restart.sh runs scaffolded migration from apps/api ───────────────────
section "20. restart.sh runs node migration from apps/api in scaffolded mode"
# @rbrasier/adapters is a dependency of apps/api, not the project root.
# Node resolves modules from CWD upward, so the migration must be started from
# apps/api, otherwise ERR_MODULE_NOT_FOUND is thrown.
if grep -q 'cd.*apps/api' restart.sh; then
  pass "restart.sh runs node migration from apps/api where @rbrasier/adapters is installed"
else
  fail "restart.sh runs node migration from project root — @rbrasier/adapters cannot be resolved (it is a dep of apps/api, not root)"
fi

# ── 21. restart.sh uses PGPASSWORD to avoid interactive password prompts ──────
section "21. restart.sh uses PGPASSWORD when creating the database"
# createdb/psql fall back to OS-level auth and may prompt for a password when
# running non-interactively. PGPASSWORD must be set from DATABASE_URL credentials
# so the safety-net db-creation step never blocks.
if grep -q "PGPASSWORD" restart.sh; then
  pass "restart.sh sets PGPASSWORD to avoid interactive password prompts"
else
  fail "restart.sh does not set PGPASSWORD — createdb may prompt for a password and block unattended runs"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────"
echo "Passed: $PASS"
echo "Failed: $FAIL"
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}All validations passed.${NC}"
  exit 0
fi
echo -e "${RED}Validation failed.${NC}"
exit 1
