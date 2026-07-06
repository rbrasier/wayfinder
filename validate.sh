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
FAILED_CHECKS=()

TEST_LOG=$(mktemp -t validate-tests.XXXXXX)
COVERAGE_LOG=$(mktemp -t validate-coverage.XXXXXX)
trap 'rm -f "$TEST_LOG" "$COVERAGE_LOG"' EXIT

pass() { echo -e "${GREEN}PASS${NC} — $1"; PASS=$((PASS + 1)); }
fail() {
  echo -e "${RED}FAIL${NC} — $1"
  FAIL=$((FAIL + 1))
  FAILED_CHECKS+=("$1")
}
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
if pnpm -s test 2>&1 | tee "$TEST_LOG"; then
  pass "tests"
else
  # pipefail propagates the pnpm exit code
  fail "tests"
fi

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

# ── 11. dependency security audit ────────────────────────────────────────────
section "11. pnpm audit (high + critical vulnerabilities)"
if pnpm audit --audit-level=high 2>&1; then
  pass "no high/critical vulnerabilities"
else
  fail "high or critical vulnerabilities found — run 'pnpm audit' for details"
fi

# ── 12. test files exist in domain and application ────────────────────────────
section "12. domain and application packages have tests"
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

# ── 13. test coverage meets thresholds (domain + application) ─────────────────
section "13. test coverage thresholds (domain + application)"
DOMAIN_PKG=$(node -e "process.stdout.write(require('./packages/domain/package.json').name)")
APP_PKG=$(node -e "process.stdout.write(require('./packages/application/package.json').name)")
if { pnpm --filter "$DOMAIN_PKG" -s test:coverage && \
     pnpm --filter "$APP_PKG" -s test:coverage; } 2>&1 | tee "$COVERAGE_LOG"; then
  pass "coverage meets thresholds"
else
  fail "coverage below thresholds — see output above (targets: 70% lines, 70% functions)"
fi

# ── 14. restart.sh uses runMigrations in scaffolded mode ─────────────────────
section "14. restart.sh uses runMigrations for scaffolded projects"
# In a scaffolded project pnpm --filter finds no workspace package for adapters.
# restart.sh must detect scaffolded mode and call runMigrations() instead.
if grep -q "runMigrations" restart.sh; then
  pass "restart.sh calls runMigrations in scaffolded mode"
else
  fail "restart.sh does not call runMigrations — scaffolded projects cannot run migrations"
fi

# ── 15. web accessibility (WCAG 2.2 AA — jsx-a11y) ───────────────────────────
# Runs the jsx-a11y "strict" ruleset over apps/web in isolation so a11y
# regressions fail CI even if the general lint config is weakened. Covers the
# machine-checkable WCAG 2.2 AA criteria (alt text, labels, ARIA, keyboard
# handlers, no positive tabindex). Runtime-only criteria (contrast, focus
# order, target size) are documented in docs/accessibility.md.
section "15. web accessibility (jsx-a11y strict)"
A11Y_CONFIG="apps/web/eslint.config.a11y.js"
if [ ! -f "$A11Y_CONFIG" ]; then
  fail "accessibility config missing — expected $A11Y_CONFIG"
elif pnpm --filter "@wayfinder/web" -s lint:a11y; then
  pass "web accessibility (jsx-a11y strict)"
else
  fail "web accessibility — jsx-a11y violations found (see output above)"
fi

# ── 16. source file size guard ────────────────────────────────────────────────
# Large files concentrate change risk and merge conflicts. Warn at 700 lines,
# fail at 800. Test files are excluded (covered by review, not by this ratchet).
# The allowlist holds legacy offenders scheduled for decomposition in
# docs/development/to-be-implemented/code-quality-hot-paths-and-decomposition.phase.md
# — they warn instead of failing. NEVER add new entries; only remove them.
section "16. source file size (warn ≥ 700, fail ≥ 800 lines)"
SIZE_WARN_LINES=700
SIZE_FAIL_LINES=800
SIZE_LEGACY_ALLOWLIST=(
  "apps/web/src/components/canvas/node-config-modal.tsx"
  "apps/web/src/app/(user)/flows/[id]/config/_content.tsx"
  "apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx"
  "apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts"
)
SIZE_FAILURES=""
SIZE_WARNINGS=""
while IFS= read -r source_file; do
  line_count=$(wc -l < "$source_file")
  [ "$line_count" -lt "$SIZE_WARN_LINES" ] && continue
  is_legacy=false
  for legacy_file in "${SIZE_LEGACY_ALLOWLIST[@]}"; do
    if [ "$source_file" = "$legacy_file" ]; then is_legacy=true; break; fi
  done
  if [ "$line_count" -ge "$SIZE_FAIL_LINES" ] && [ "$is_legacy" = false ]; then
    SIZE_FAILURES+="  $line_count  $source_file\n"
  else
    SIZE_WARNINGS+="  $line_count  $source_file\n"
  fi
done < <(find packages/*/src apps/*/src -type f \( -name "*.ts" -o -name "*.tsx" \) \
  ! -name "*.test.ts" ! -name "*.test.tsx" ! -name "*.spec.ts" 2>/dev/null)
if [ -n "$SIZE_WARNINGS" ]; then
  warn "files at or above $SIZE_WARN_LINES lines — split when next touched:"
  printf '%b' "$SIZE_WARNINGS"
fi
if [ -z "$SIZE_FAILURES" ]; then
  pass "no non-legacy source file at or above $SIZE_FAIL_LINES lines"
else
  fail "source files at or above $SIZE_FAIL_LINES lines — decompose before shipping:"
  printf '%b' "$SIZE_FAILURES"
fi

# ── 17. application layer purity ─────────────────────────────────────────────
# Allowlist counterpart to the ESLint denylist: packages/application may import
# only @rbrasier/domain and @rbrasier/shared. A denylist misses newly added
# dependencies; this catches any non-relative import outside the two packages.
section "17. packages/application imports only @rbrasier/domain and @rbrasier/shared"
APPLICATION_LEAKS=$(grep -rnE "from ['\"][^.]" packages/application/src \
    --include="*.ts" --exclude="*.test.ts" 2>/dev/null \
  | grep -vE "from ['\"]@rbrasier/(domain|shared)['\"/]" \
  | grep -vE "^[^:]+:[0-9]+:\s*//")
if [ -z "$APPLICATION_LEAKS" ]; then
  pass "application purity"
else
  fail "application purity — imports outside @rbrasier/domain and @rbrasier/shared:"
  echo "$APPLICATION_LEAKS"
fi

# ── 18. apps do not import the ORM directly ──────────────────────────────────
# Apps wire adapters; they must not talk to Drizzle or the driver themselves.
# e2e-fixtures.ts is exempt: test seeding writes rows the product deliberately
# exposes no API for.
section "18. apps/* do not import drizzle-orm or postgres directly"
APP_ORM_LEAKS=$(grep -rnE "from ['\"](drizzle-orm|postgres)['\"/]" apps/web/src apps/api/src \
    --include="*.ts" --include="*.tsx" 2>/dev/null \
  | grep -v "e2e-fixtures.ts" \
  | grep -vE "^[^:]+:[0-9]+:\s*//")
if [ -z "$APP_ORM_LEAKS" ]; then
  pass "apps do not import the ORM"
else
  fail "apps import the ORM directly — go through @rbrasier/adapters:"
  echo "$APP_ORM_LEAKS"
fi

# ── 19. no focused tests ─────────────────────────────────────────────────────
# A committed .only silently skips the rest of the suite in CI.
section "19. no describe.only / it.only / test.only committed"
FOCUSED_TESTS=$(grep -rnE "\b(describe|it|test)\.only\(" \
    packages/*/src apps/*/src tests \
    --include="*.test.ts" --include="*.test.tsx" --include="*.spec.ts" 2>/dev/null)
if [ -z "$FOCUSED_TESTS" ]; then
  pass "no focused tests"
else
  fail "focused tests found — remove .only:"
  echo "$FOCUSED_TESTS"
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

echo
echo -e "${RED}Failed checks:${NC}"
for check in "${FAILED_CHECKS[@]}"; do
  echo "  - $check"
done

# If the test or coverage step failed, surface the individual failing tests
# from the captured logs. Vitest marks failures with "FAIL <path>" lines
# and "× <test name>" / " ✗ <test name>" lines; we union both styles.
extract_failing_tests() {
  local log="$1"
  [ -s "$log" ] || return 0
  grep -E '(^|[[:space:]])(FAIL[[:space:]]|×[[:space:]]|✗[[:space:]])' "$log" \
    | sed -E 's/\x1B\[[0-9;]*[mK]//g' \
    | sort -u
}

TESTS_FAILED=false
COVERAGE_FAILED=false
for check in "${FAILED_CHECKS[@]}"; do
  case "$check" in
    tests) TESTS_FAILED=true ;;
    "coverage below thresholds"*) COVERAGE_FAILED=true ;;
  esac
done

if [ "$TESTS_FAILED" = true ]; then
  echo
  echo -e "${RED}Failing tests (from pnpm test):${NC}"
  failing=$(extract_failing_tests "$TEST_LOG")
  if [ -n "$failing" ]; then
    echo "$failing" | sed 's/^/  /'
  else
    echo "  (no per-test failure lines detected — see full output above)"
  fi
fi

if [ "$COVERAGE_FAILED" = true ]; then
  echo
  echo -e "${RED}Failing tests (from coverage run):${NC}"
  failing=$(extract_failing_tests "$COVERAGE_LOG")
  if [ -n "$failing" ]; then
    echo "$failing" | sed 's/^/  /'
  else
    echo "  (no per-test failure lines detected — coverage threshold likely the cause; see output above)"
  fi
fi

echo
echo -e "${RED}Validation failed.${NC}"
exit 1
